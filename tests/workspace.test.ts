import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDatabase, type DatabaseContext } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed";
import { getWorkspace, mutateWorkspace } from "../src/server/workspace";
import * as s from "../src/server/db/schema";
import { moneyToMinor, eventInput, quoteOption } from "../src/domain/validation";

const contexts: DatabaseContext[] = [];
function db(filename = ":memory:") {
  const ctx = openDatabase(filename);
  contexts.push(ctx);
  seedDatabase(ctx);
  return ctx;
}
afterEach(() => {
  for (const ctx of contexts.splice(0)) if (ctx.sqlite.open) ctx.sqlite.close();
});
function attachEvidence(ctx: DatabaseContext) {
  const now = new Date().toISOString();
  for (const id of ["person", "reference"])
    ctx.db
      .insert(s.assets)
      .values({
        id,
        eventId: "riverside-cup",
        kind: id,
        relativePath: `${id}.jpg`,
        sha256: "test-hash",
        mime: "image/jpeg",
        permission: { basis: "test-only" },
        createdAt: now,
      })
      .run();
  ctx.db
    .insert(s.previews)
    .values({
      id: "preview",
      eventId: "riverside-cup",
      designId: "northbank-red",
      personAssetId: "person",
      referenceAssetId: "reference",
      inputHash: "test",
      apiVersion: "v3",
      parameters: {},
      status: "success",
      createdAt: now,
    })
    .run();
  ctx.db
    .insert(s.reviews)
    .values({
      id: "review",
      eventId: "riverside-cup",
      fixtureId: "fixture-1",
      optionA: "option-northbank-red",
      optionB: "option-parkside-green",
      status: "approved",
      reviewer: "Test reviewer",
      reason: "Test-only decision",
      evidence: { preview: "preview", designRevision: 1 },
      createdAt: now,
    })
    .run();
  ctx.db
    .insert(s.plans)
    .values({
      id: "plan",
      eventId: "riverside-cup",
      eventRevision: 1,
      status: "feasible",
      snapshot: { test: true },
      createdAt: now,
    })
    .run();
  ctx.db
    .insert(s.exportsTable)
    .values({ id: "export", planId: "plan", snapshot: { budgetMinor: 90000 }, createdAt: now })
    .run();
}
describe("persistent workspace", () => {
  it("creates illustrative inputs without invented approvals or API results", () => {
    const ctx = db();
    const data = getWorkspace(ctx);
    expect(data.teams).toHaveLength(4);
    expect(data.designs).toHaveLength(8);
    expect(data.fixtures).toHaveLength(3);
    expect(data.reviews).toEqual([]);
    expect(data.previews).toEqual([]);
    expect(data.integration.liveValidated).toBe(false);
    expect(seedDatabase(ctx)).toBe(false);
  });
  it("keeps event changes across a new connection and rejects lost updates atomically", () => {
    const filename = join(mkdtempSync(join(tmpdir(), "matchclear-test-")), "workspace.sqlite");
    const ctx = db(filename);
    mutateWorkspace(ctx, {
      op: "updateEvent",
      eventId: "riverside-cup",
      revision: 1,
      input: { name: "Updated Cup", currency: "EUR", budgetMinor: 100000, eventDate: "" },
    });
    expect(() =>
      mutateWorkspace(ctx, {
        op: "addTeam",
        eventId: "riverside-cup",
        revision: 1,
        input: {
          name: "Stale team",
          code: "ST",
          quantities: { XS: 0, S: 0, M: 12, L: 0, XL: 0, XXL: 0 },
        },
      }),
    ).toThrow("another tab");
    const reopened = openDatabase(filename);
    contexts.push(reopened);
    expect(getWorkspace(reopened).event?.name).toBe("Updated Cup");
    expect(getWorkspace(reopened).teams).toHaveLength(4);
    expect(getWorkspace(reopened).event?.revision).toBe(2);
  });
  it("rejects self fixtures, duplicate pairs and cross-event team references", () => {
    const ctx = db();
    const base = { op: "addFixture", eventId: "riverside-cup", revision: 1 };
    expect(() =>
      mutateWorkspace(ctx, {
        ...base,
        input: { teamA: "northbank", teamB: "northbank", label: "Self match" },
      }),
    ).toThrow("itself");
    expect(() =>
      mutateWorkspace(ctx, {
        ...base,
        input: { teamA: "parkside", teamB: "northbank", label: "Duplicate" },
      }),
    ).toThrow("already");
    const other = mutateWorkspace(ctx, {
      op: "createEvent",
      input: { name: "Other cup", currency: "GBP", budgetMinor: 50000, eventDate: "" },
    });
    expect(() =>
      mutateWorkspace(ctx, {
        ...base,
        eventId: other.eventId,
        input: { teamA: "northbank", teamB: "parkside", label: "Wrong event" },
      }),
    ).toThrow("this event");
    expect(getWorkspace(ctx).event?.revision).toBe(1);
  });
  it("invalidates previews, reviews and plans after an appearance change without rewriting exports", () => {
    const ctx = db();
    attachEvidence(ctx);
    mutateWorkspace(ctx, {
      op: "updateDesign",
      eventId: "riverside-cup",
      revision: 1,
      designId: "northbank-red",
      input: {
        name: "Northbank revised",
        colour: "Dark red",
        primaryHex: "#993333",
        secondaryHex: "#ffffff",
        pattern: "panel",
      },
    });
    expect(ctx.db.select().from(s.previews).get()!.stale).toBe(true);
    expect(ctx.db.select().from(s.reviews).get()!.status).toBe("stale");
    expect(ctx.db.select().from(s.plans).get()!.stale).toBe(true);
    expect(ctx.db.select().from(s.exportsTable).get()!.snapshot).toEqual({ budgetMinor: 90000 });
    expect(
      ctx.db.select().from(s.designs).where(eq(s.designs.id, "northbank-red")).get()!.revision,
    ).toBe(2);
  });
  it("preserves visual evidence after a price-only change while invalidating the plan", () => {
    const ctx = db();
    attachEvidence(ctx);
    const prior = getWorkspace(ctx).options.find((o) => o.id === "option-parkside-navy")!;
    mutateWorkspace(ctx, {
      op: "updateOption",
      eventId: "riverside-cup",
      revision: 1,
      optionId: prior.id,
      input: {
        unitMinor: 1300,
        setupMinor: prior.setupMinor,
        minimumOrder: prior.minimumOrder,
        stock: prior.stock,
        available: true,
        seller: prior.seller,
        priceDate: prior.priceDate,
      },
    });
    expect(ctx.db.select().from(s.previews).get()!.stale).toBe(false);
    expect(ctx.db.select().from(s.reviews).get()!.status).toBe("approved");
    expect(ctx.db.select().from(s.plans).get()!.stale).toBe(true);
  });
  it("does not allow arbitrary currency conversion or nonzero purchase costs on owned shirts", () => {
    const ctx = db();
    expect(() =>
      mutateWorkspace(ctx, {
        op: "updateEvent",
        eventId: "riverside-cup",
        revision: 1,
        input: { name: "Cup", currency: "USD", budgetMinor: 90000, eventDate: "" },
      }),
    ).toThrow("Currency");
    const prior = getWorkspace(ctx).options[0];
    expect(() =>
      mutateWorkspace(ctx, {
        op: "updateOption",
        eventId: "riverside-cup",
        revision: 1,
        optionId: prior.id,
        input: { ...prior, unitMinor: 1000 },
      }),
    ).toThrow("Owned");
  });
  it("validates impossible dates without throwing a runtime date error", () => {
    expect(
      eventInput.safeParse({
        name: "Cup",
        currency: "EUR",
        budgetMinor: 0,
        eventDate: "2026-99-99",
      }).success,
    ).toBe(false);
    expect(
      eventInput.safeParse({
        name: "Cup",
        currency: "EUR",
        budgetMinor: 0,
        eventDate: "2026-02-30",
      }).success,
    ).toBe(false);
  });
  it("calculates exact money and exposes minimum-order extras and unavailable sizes", () => {
    expect(moneyToMinor("12.35")).toBe(1235);
    expect(moneyToMinor("0.1")).toBe(10);
    expect(() => moneyToMinor("12.345")).toThrow();
    const quote = quoteOption(
      {
        owned: false,
        unitMinor: 1235,
        setupMinor: 1500,
        minimumOrder: 15,
        stock: { M: 8 },
        available: true,
      },
      { M: 12 },
    );
    expect(quote.totalMinor).toBe(20025);
    expect(quote.eligible).toBe(false);
    expect(quote.extraUnits).toBe(3);
    expect(quote.minimumOrderNeedsSizes).toBe(true);
  });
  it("archives without deleting data or automatically reseeding it", () => {
    const ctx = db();
    mutateWorkspace(ctx, { op: "archiveEvent", eventId: "riverside-cup", revision: 1 });
    expect(getWorkspace(ctx).event).toBeNull();
    expect(seedDatabase(ctx)).toBe(false);
    expect(ctx.db.select().from(s.teams).all()).toHaveLength(4);
  });
});

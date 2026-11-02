import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { openDatabase, type DatabaseContext } from "../../src/server/db";
import * as s from "../../src/server/db/schema";
import { storePhoto, applyPipeline, readPipelineState } from "../../src/server/pipeline";
import { PrivateFiles } from "../../src/server/storage/private-files";
import { workerTick } from "../../src/worker/process";
import { mutateWorkspace } from "../../src/server/workspace";
import { viewModes } from "../../src/domain/pipeline";

const roots: string[] = [];
const contexts: DatabaseContext[] = [];
const testRoot = resolve(".local", "test-files");
beforeEach(() => {
  vi.stubEnv("YOUCAM_API_KEY", "unit-test-only-no-network");
  vi.stubEnv("MATCHCLEAR_API_UNIT_LIMIT", "40");
});
afterEach(() => {
  contexts.splice(0).forEach((ctx) => {
    if (ctx.sqlite.open) ctx.sqlite.close();
  });
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(testRoot + sep)) throw new Error("Unexpected test cleanup path");
    rmSync(root, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});
export async function setup() {
  mkdirSync(testRoot, { recursive: true });
  const root = mkdtempSync(resolve(testRoot, "pipeline-"));
  roots.push(root);
  const ctx = openDatabase(":memory:");
  contexts.push(ctx);
  const files = new PrivateFiles(root);
  const now = new Date().toISOString();
  ctx.db
    .insert(s.events)
    .values({
      id: "flow",
      name: "Test flow cup",
      currency: "EUR",
      budgetMinor: 10000,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  for (const id of ["A", "B"]) {
    ctx.db
      .insert(s.teams)
      .values({
        id,
        eventId: "flow",
        name: `Team ${id}`,
        code: id + id,
        quantities: { XS: 0, S: 0, M: 12, L: 0, XL: 0, XXL: 0 },
      })
      .run();
    ctx.db
      .insert(s.designs)
      .values({
        id: `d${id}`,
        eventId: "flow",
        name: `Shirt ${id}`,
        colour: id === "A" ? "Red" : "White",
        primaryHex: id === "A" ? "#ff0000" : "#ffffff",
        secondaryHex: "#000000",
        pattern: "solid",
      })
      .run();
    ctx.db
      .insert(s.options)
      .values({
        id: `o${id}`,
        eventId: "flow",
        teamId: id,
        designId: `d${id}`,
        owned: true,
        unitMinor: 0,
        setupMinor: 0,
        minimumOrder: 0,
        stock: { XS: 0, S: 0, M: 12, L: 0, XL: 0, XXL: 0 },
        available: true,
        seller: "Test-only inventory",
        priceDate: now.slice(0, 10),
      })
      .run();
  }
  ctx.db
    .insert(s.fixtures)
    .values({
      id: "AB",
      eventId: "flow",
      teamA: "A",
      teamB: "B",
      pairKey: "A|B",
      label: "Opening match",
    })
    .run();
  const image = await sharp({
    create: { width: 600, height: 600, channels: 3, background: "#ca6040" },
  })
    .jpeg()
    .toBuffer();
  const revision = () => ctx.db.select().from(s.events).get()!.revision;
  const upload = async (kind: "person" | "reference", targetId: string) => {
    const form = new FormData();
    form.set("eventId", "flow");
    form.set("revision", String(revision()));
    form.set("kind", kind);
    form.set("targetId", targetId);
    form.set("permission", "true");
    form.set("adult", "true");
    form.set("basis", "Synthetic unit-test fixture; never uploaded externally");
    form.set("photo", new File([image], "fixture.jpg", { type: "image/jpeg" }));
    return storePhoto(ctx, form, files);
  };
  for (const id of ["A", "B"]) {
    await upload("person", id);
    await upload("reference", `d${id}`);
  }
  const command = (op: string, args: Record<string, unknown> = {}) =>
    applyPipeline(ctx, { op, eventId: "flow", revision: revision(), ...args });
  const client = {
    upload: vi.fn(async () => "file-id"),
    submit: vi.fn(async () => "provider-task"),
    status: vi.fn(async () => ({
      status: "success",
      url: "https://example.s3.amazonaws.com/result.jpg",
      error: null,
    })),
    download: vi.fn(async () => image),
  };
  const queue = () =>
    command("queuePreviews", {
      consentConfirmed: true,
      items: [
        { teamId: "A", designId: "dA" },
        { teamId: "B", designId: "dB" },
      ],
    });
  return { ctx, files, command, client, queue, revision, upload };
}
export async function prepared() {
  const env = await setup();
  env.queue();
  await workerTick(env.ctx, { client: env.client, files: env.files });
  await workerTick(env.ctx, { client: env.client, files: env.files });
  const previews = env.ctx.db.select().from(s.previews).all();
  for (const p of previews) {
    env.command("acceptPreview", {
      previewId: p.id,
      acceptance: "accepted",
      reviewer: "Test reviewer",
      reason: "Synthetic test inspection only",
    });
    env.command("saveRegion", {
      previewId: p.id,
      polygon: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 },
      ],
    });
  }
  const a = previews.find((p) => p.teamId === "A")!,
    b = previews.find((p) => p.teamId === "B")!;
  const review = (status = "approved") =>
    env.command("reviewPair", {
      fixtureId: "AB",
      optionA: "oA",
      optionB: "oB",
      previewA: a.id,
      previewB: b.id,
      status,
      reviewer: "Test reviewer",
      reason: "Synthetic test decision, not an accessibility result",
      viewedModes: [...viewModes],
    });
  return { ...env, a, b, review };
}

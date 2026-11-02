import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { prepared } from "./helpers/workflow";
import { currentReview, usablePreview } from "../src/server/evidence";
import { TRANSFORM_VERSION, type ReviewEvidence, viewModes } from "../src/domain/pipeline";
import { workerTick } from "../src/worker/process";
import { orderCommand, getBrief } from "../src/server/orders";
import * as s from "../src/server/db/schema";

describe("expanded review coverage", () => {
  it("keeps saved reviews and blocks an outdated worker instead of misreporting missing evidence", async () => {
    const env = await prepared();
    env.review();
    const review = env.ctx.db.select().from(s.reviews).get()!;
    env.ctx.db
      .delete(s.runtimeSettings)
      .where(eq(s.runtimeSettings.key, "workerReviewPolicy"))
      .run();
    expect(() => env.command("queuePlan", { locks: {}, baseline: { A: "oA", B: "oB" } })).toThrow(
      "comparisons are saved",
    );
    expect(
      currentReview(
        env.ctx,
        env.ctx.db.select().from(s.reviews).where(eq(s.reviews.id, review.id)).get()!,
      ),
    ).toBe(true);
    expect(
      env.ctx.db
        .select()
        .from(s.jobs)
        .all()
        .filter((j) => j.kind === "plan"),
    ).toHaveLength(0);
    await workerTick(env.ctx, { onlyKinds: ["plan"], files: env.files });
    env.command("queuePlan", { locks: {}, baseline: { A: "oA", B: "oB" } });
    await workerTick(env.ctx, { onlyKinds: ["plan"], files: env.files });
    expect(env.ctx.db.select().from(s.plans).get()).toMatchObject({
      status: "optimal",
      stale: false,
    });
  });
  it("holds a job from an incompatible policy without publishing a misleading plan", async () => {
    const env = await prepared();
    env.review();
    env.command("queuePlan", { locks: {}, baseline: { A: "oA", B: "oB" } });
    const job = env.ctx.db
      .select()
      .from(s.jobs)
      .all()
      .find((j) => j.kind === "plan")!;
    env.ctx.db
      .update(s.jobs)
      .set({ payload: { ...(job.payload as object), reviewPolicyVersion: "future-policy" } })
      .where(eq(s.jobs.id, job.id))
      .run();
    await workerTick(env.ctx, { onlyKinds: ["plan"], files: env.files });
    expect(env.ctx.db.select().from(s.jobs).where(eq(s.jobs.id, job.id)).get()).toMatchObject({
      status: "needs-attention",
      errorCode: "WORKER_POLICY_CHANGED",
    });
    expect(env.ctx.db.select().from(s.plans).all()).toHaveLength(0);
  });
  it("refuses a four-view approval even when supplied with the current transform version", async () => {
    const env = await prepared();
    env.review();
    const row = env.ctx.db.select().from(s.reviews).get()!;
    expect(currentReview(env.ctx, row)).toBe(true);
    expect(
      currentReview(env.ctx, {
        ...row,
        evidence: {
          ...(row.evidence as ReviewEvidence),
          transformVersion: TRANSFORM_VERSION,
          viewedModes: ["normal", "grayscale", "protan", "deutan"],
        },
      }),
    ).toBe(false);
    expect(() =>
      env.command("reviewPair", {
        fixtureId: "AB",
        optionA: "oA",
        optionB: "oB",
        previewA: env.a.id,
        previewB: env.b.id,
        status: "approved",
        reviewer: "Test reviewer",
        reason: "Incomplete screen review",
        viewedModes: viewModes.filter((m) => m !== "tritanomaly"),
      }),
    ).toThrow("all 8");
  });
  it("preserves old outlines and photos but invalidates old plans and keeps briefs historical", async () => {
    const env = await prepared();
    env.review();
    env.command("queuePlan", { locks: {}, baseline: { A: "oA", B: "oB" } });
    await workerTick(env.ctx, { onlyKinds: ["plan"], files: env.files });
    const plan = env.ctx.db.select().from(s.plans).get()!;
    const confirm = orderCommand(env.ctx, {
      op: "confirmPlan",
      eventId: "flow",
      revision: env.revision(),
      planId: plan.id,
      reviewer: "Synthetic check",
    });
    const brief = orderCommand(env.ctx, {
      op: "createBrief",
      eventId: "flow",
      revision: env.revision(),
      confirmationId: confirm.id,
    });
    const frozen = getBrief(env.ctx, "flow", brief.id).snapshot;
    const row = env.ctx.db.select().from(s.reviews).get()!;
    env.ctx.db.update(s.regions).set({ transformVersion: "machado2009-srgb-v1" }).run();
    env.ctx.db
      .update(s.reviews)
      .set({
        evidence: {
          ...(row.evidence as ReviewEvidence),
          transformVersion: "machado2009-srgb-v1",
          viewedModes: ["normal", "grayscale", "protan", "deutan"],
        },
      })
      .where(eq(s.reviews.id, row.id))
      .run();
    const before = env.revision();
    env.ctx.sqlite.exec(readFileSync("migrations/0004_expanded_screening_views.sql", "utf8"));
    expect(env.revision()).toBe(before + 1);
    expect(usablePreview(env.ctx, env.a.id, "flow", true)).not.toBeNull();
    expect(usablePreview(env.ctx, env.b.id, "flow", true)).not.toBeNull();
    expect(env.ctx.db.select().from(s.plans).get()!.stale).toBe(true);
    expect(currentReview(env.ctx, env.ctx.db.select().from(s.reviews).get()!)).toBe(false);
    expect(getBrief(env.ctx, "flow", brief.id).outdated).toBe(true);
    expect(getBrief(env.ctx, "flow", brief.id).snapshot).toEqual(frozen);
    expect(() =>
      orderCommand(env.ctx, {
        op: "createBrief",
        eventId: "flow",
        revision: env.revision(),
        confirmationId: confirm.id,
      }),
    ).toThrow("outdated");
  });
});

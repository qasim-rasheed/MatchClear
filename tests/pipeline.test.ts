import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "../src/server/db/schema";
import { readPipelineState } from "../src/server/pipeline";
import { workerTick } from "../src/worker/process";
import { setup, prepared } from "./helpers/workflow";
describe("durable previews, evidence and planning", () => {
  it("restricts test workers to their exact job allowlist and planning workers to non-render jobs", async () => {
    const env = await setup();
    env.queue();
    const jobs = env.ctx.db.select().from(s.jobs).all();
    expect(
      await workerTick(env.ctx, {
        client: env.client,
        files: env.files,
        onlyKinds: ["plan", "healthcheck"],
      }),
    ).toBe(false);
    expect(env.client.upload).not.toHaveBeenCalled();
    await workerTick(env.ctx, { client: env.client, files: env.files, onlyJobIds: [jobs[1].id] });
    expect(env.ctx.db.select().from(s.jobs).where(eq(s.jobs.id, jobs[0].id)).get()!.status).toBe(
      "queued",
    );
    expect(env.ctx.db.select().from(s.jobs).where(eq(s.jobs.id, jobs[1].id)).get()!.status).toBe(
      "success",
    );
    expect(env.client.submit).toHaveBeenCalledTimes(1);
  });
  it("stops before submission and releases its lease when an input is replaced during upload", async () => {
    const env = await setup();
    env.command("queuePreviews", {
      consentConfirmed: true,
      items: [{ teamId: "A", designId: "dA" }],
    });
    env.client.upload.mockImplementationOnce(async () => {
      await env.upload("reference", "dA");
      return "old-source-id";
    });
    await workerTick(env.ctx, { client: env.client, files: env.files });
    expect(env.client.submit).not.toHaveBeenCalled();
    const job = env.ctx.db.select().from(s.jobs).get()!;
    expect(job.status).toBe("cancelled");
    expect(job.leaseOwner).toBeNull();
    expect(env.ctx.db.select().from(s.previews).get()!.stale).toBe(true);
  });
  it("uses the latest decision and never revives an older approval", async () => {
    const env = await prepared();
    env.review("approved");
    env.review("rejected");
    const current = readPipelineState(env.ctx, "flow").reviews.filter((r) => r.current);
    expect(current).toHaveLength(1);
    expect(current[0].status).toBe("rejected");
    env.command("queuePlan", { locks: {}, baseline: {} });
    await workerTick(env.ctx, { onlyKinds: ["plan"] });
    expect(env.ctx.db.select().from(s.plans).get()!.status).toBe("infeasible");
  });
  it("deduplicates a batch and reserves its unit allowance atomically", async () => {
    const env = await setup();
    env.queue();
    const revision = env.revision();
    env.queue();
    expect(env.ctx.db.select().from(s.previews).all()).toHaveLength(2);
    expect(
      env.ctx.db
        .select()
        .from(s.usage)
        .all()
        .reduce((sum, x) => sum + x.estimatedUnits, 0),
    ).toBe(4);
    expect(env.revision()).toBe(revision);
    const next = await setup();
    vi.stubEnv("MATCHCLEAR_API_UNIT_LIMIT", "2");
    expect(() => next.queue()).toThrow("allowance");
    expect(next.ctx.db.select().from(s.jobs).all()).toHaveLength(0);
  });
  it("persists completed outputs and requires acceptance plus all mode evidence", async () => {
    const env = await setup();
    env.queue();
    await workerTick(env.ctx, { client: env.client, files: env.files });
    const preview = env.ctx.db
      .select()
      .from(s.previews)
      .all()
      .find((p) => p.status === "success")!;
    expect(preview.acceptance).toBe("pending");
    expect(readPipelineState(env.ctx, "flow").previews[0].usable).toBe(false);
    expect(() =>
      env.command("saveRegion", {
        previewId: preview.id,
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      }),
    ).toThrow("Accept");
    expect(() =>
      env.command("reviewPair", {
        fixtureId: "AB",
        optionA: "oA",
        optionB: "oB",
        previewA: preview.id,
        previewB: preview.id,
        status: "approved",
        reviewer: "AB",
        reason: "Missing views",
        viewedModes: ["normal"],
      }),
    ).toThrow("four");
  });
  it("resumes a saved running task after a new worker tick without submitting twice", async () => {
    const env = await setup();
    env.command("queuePreviews", {
      consentConfirmed: true,
      items: [{ teamId: "A", designId: "dA" }],
    });
    env.client.status.mockResolvedValueOnce({
      status: "running",
      url: null as unknown as string,
      error: null,
    });
    await workerTick(env.ctx, { client: env.client, files: env.files });
    const job = env.ctx.db.select().from(s.jobs).get()!;
    expect(job.providerTaskId).toBe("provider-task");
    env.ctx.db
      .update(s.jobs)
      .set({ nextRunAt: "2000-01-01T00:00:00.000Z" })
      .where(eq(s.jobs.id, job.id))
      .run();
    await workerTick(env.ctx, { client: env.client, files: env.files });
    expect(env.client.submit).toHaveBeenCalledTimes(1);
    expect(env.ctx.db.select().from(s.previews).get()!.status).toBe("success");
  });
  it("quarantines an expired uncertain submission without making a new provider call", async () => {
    const env = await setup();
    env.queue();
    const job = env.ctx.db.select().from(s.jobs).all()[0];
    env.ctx.db
      .update(s.jobs)
      .set({ status: "submitting", leaseUntil: "2000-01-01T00:00:00.000Z" })
      .where(eq(s.jobs.id, job.id))
      .run();
    await workerTick(env.ctx, { client: env.client, files: env.files });
    expect(env.client.submit).not.toHaveBeenCalled();
    expect(env.ctx.db.select().from(s.jobs).where(eq(s.jobs.id, job.id)).get()!.status).toBe(
      "needs-attention",
    );
  });
  it("discards a late result when its person photo is deleted during the provider call", async () => {
    const env = await setup();
    env.command("queuePreviews", {
      consentConfirmed: true,
      items: [{ teamId: "A", designId: "dA" }],
    });
    const source = env.ctx.db.select().from(s.teams).where(eq(s.teams.id, "A")).get()!
      .personAssetId!;
    env.client.status.mockImplementationOnce(async () => {
      env.command("deleteAsset", { assetId: source });
      return { status: "success", url: "https://example.s3.amazonaws.com/result.jpg", error: null };
    });
    await workerTick(env.ctx, { client: env.client, files: env.files });
    expect(env.client.download).not.toHaveBeenCalled();
    expect(env.ctx.db.select().from(s.previews).get()!.status).toBe("deleted");
    expect(
      env.ctx.db
        .select()
        .from(s.assets)
        .all()
        .some((a) => a.kind === "output"),
    ).toBe(false);
  });
  it("uses current human reviews for a saved plan and invalidates them after region changes", async () => {
    const env = await prepared();
    env.review();
    env.command("queuePlan", { locks: {}, baseline: { A: "oA", B: "oB" } });
    await workerTick(env.ctx, { files: env.files });
    const plan = env.ctx.db.select().from(s.plans).get()!;
    expect(plan.status).toBe("optimal");
    expect(plan.totalMinor).toBe(0);
    expect(plan.stale).toBe(false);
    env.command("saveRegion", {
      previewId: env.a.id,
      polygon: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    });
    expect(readPipelineState(env.ctx, "flow").reviews[0].current).toBe(false);
    expect(env.ctx.db.select().from(s.plans).get()!.stale).toBe(true);
  });
  it("does not carry an approval through a replacement garment reference", async () => {
    const env = await prepared();
    env.review();
    await env.upload("reference", "dA");
    expect(readPipelineState(env.ctx, "flow").reviews[0].current).toBe(false);
    expect(readPipelineState(env.ctx, "flow").previews.find((p) => p.id === env.a.id)!.stale).toBe(
      true,
    );
  });
  it("reports pending evidence and never saves an approved plan from unreviewed pairs", async () => {
    const env = await prepared();
    env.command("queuePlan", { locks: {}, baseline: {} });
    await workerTick(env.ctx, { files: env.files });
    expect(env.ctx.db.select().from(s.plans).get()!.status).toBe("incomplete");
  });
});

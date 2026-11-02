import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { openDatabase, type DatabaseContext } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { storePhoto, applyPipeline, readPipelineState } from "../src/server/pipeline";
import { PrivateFiles } from "../src/server/storage/private-files";
import { workerTick } from "../src/worker/process";
import { mutateWorkspace } from "../src/server/workspace";
import { viewModes } from "../src/domain/pipeline";

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
async function setup() {
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
async function prepared() {
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

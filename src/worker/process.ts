import { and, desc, eq } from "drizzle-orm";
import type { DatabaseContext } from "../server/db";
import * as s from "../server/db/schema";
import { PrivateFiles } from "../server/storage/private-files";
import { unlink } from "node:fs/promises";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { ProviderError, YouCamClient } from "../server/youcam/client";
import { bumpEvent, currentReview, usablePreview } from "../server/evidence";
import { solve, type PairDecision, type PlanningInput } from "../lib/planner/solve";
import { quoteOption } from "../domain/validation";
import { retryLocalDeletions } from "../server/privacy";
import { TRANSFORM_VERSION } from "../domain/pipeline";

type RenderClient = Pick<YouCamClient, "upload" | "submit" | "status" | "download">;
type Payload = {
  eventId?: string;
  previewId?: string;
  failures?: number;
  eventRevision?: number;
  locks?: Record<string, string>;
  baseline?: Record<string, string>;
  reviewPolicyVersion?: string;
};

export function planningInput(
  ctx: DatabaseContext,
  eventId: string,
  locks: Record<string, string>,
  baseline: Record<string, string>,
): PlanningInput {
  const event = ctx.db.select().from(s.events).where(eq(s.events.id, eventId)).get()!;
  const teams = ctx.db.select().from(s.teams).where(eq(s.teams.eventId, eventId)).all();
  const fixtures = ctx.db.select().from(s.fixtures).where(eq(s.fixtures.eventId, eventId)).all();
  const excluded: PlanningInput["excluded"] = [];
  const candidates: PlanningInput["candidates"] = [];
  for (const option of ctx.db
    .select()
    .from(s.options)
    .where(eq(s.options.eventId, eventId))
    .all()) {
    const team = teams.find((t) => t.id === option.teamId);
    if (!team) continue;
    const quote = quoteOption(option, team.quantities);
    if (!quote.eligible || quote.minimumOrderNeedsSizes) {
      excluded.push({
        teamId: team.id,
        optionId: option.id,
        reason: !option.available
          ? "Marked unavailable"
          : quote.minimumOrderNeedsSizes
            ? "Allocate sizes for extra minimum-order units"
            : "Required sizes or quantities unavailable",
      });
      continue;
    }
    const design = ctx.db.select().from(s.designs).where(eq(s.designs.id, option.designId)).get()!;
    const visualReady = ctx.db
      .select()
      .from(s.previews)
      .where(and(eq(s.previews.teamId, team.id), eq(s.previews.designId, option.designId)))
      .all()
      .some((p) => usablePreview(ctx, p.id, eventId, true));
    candidates.push({
      id: option.id,
      teamId: team.id,
      designId: option.designId,
      label: `${team.name}: ${design.name}`,
      costMinor: quote.totalMinor,
      visualReady,
    });
  }
  const decisions = new Map<string, PairDecision>();
  for (const r of ctx.db
    .select()
    .from(s.reviews)
    .where(eq(s.reviews.eventId, eventId))
    .orderBy(desc(s.reviews.createdAt), desc(s.reviews.revision))
    .all()) {
    const key = `${r.fixtureId}|${r.optionA}|${r.optionB}`;
    if (!decisions.has(key))
      decisions.set(key, {
        fixtureId: r.fixtureId,
        optionA: r.optionA,
        optionB: r.optionB,
        status:
          currentReview(ctx, r) && ["approved", "rejected", "inconclusive"].includes(r.status)
            ? (r.status as PairDecision["status"])
            : "pending",
      });
  }
  return {
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    fixtures,
    candidates,
    decisions: [...decisions.values()],
    budgetMinor: event.budgetMinor,
    locks,
    baseline,
    excluded,
  };
}

export async function workerTick(
  ctx: DatabaseContext,
  dependencies: {
    client?: RenderClient;
    files?: PrivateFiles;
    now?: () => Date;
    onlyJobIds?: string[];
    onlyKinds?: string[];
  } = {},
) {
  await retryLocalDeletions(ctx, dependencies.files);
  const now = () => (dependencies.now?.() || new Date()).toISOString();
  ctx.db
    .insert(s.runtimeSettings)
    .values({ key: "workerHeartbeat", value: now() })
    .onConflictDoUpdate({ target: s.runtimeSettings.key, set: { value: now() } })
    .run();
  const workerMode = dependencies.onlyJobIds
    ? "restricted"
    : dependencies.onlyKinds && !dependencies.onlyKinds.includes("render")
      ? "plans-only"
      : "all";
  ctx.db
    .insert(s.runtimeSettings)
    .values({ key: "workerReviewPolicy", value: TRANSFORM_VERSION })
    .onConflictDoUpdate({ target: s.runtimeSettings.key, set: { value: TRANSFORM_VERSION } })
    .run();
  ctx.db
    .insert(s.runtimeSettings)
    .values({ key: "workerMode", value: workerMode })
    .onConflictDoUpdate({ target: s.runtimeSettings.key, set: { value: workerMode } })
    .run();
  const leaseOwner = crypto.randomUUID();
  const claimed = ctx.sqlite
    .transaction(() => {
      const job = ctx.db
        .select()
        .from(s.jobs)
        .all()
        .find(
          (j) =>
            ["render", "plan", "healthcheck"].includes(j.kind) &&
            (!dependencies.onlyJobIds || dependencies.onlyJobIds.includes(j.id)) &&
            (!dependencies.onlyKinds || dependencies.onlyKinds.includes(j.kind)) &&
            ["queued", "uploading", "submitting", "running"].includes(j.status) &&
            (!j.nextRunAt || j.nextRunAt <= now()) &&
            (!j.leaseUntil || j.leaseUntil < now()),
        );
      if (!job) return null;
      if (job.status === "submitting" && !job.providerTaskId) {
        ctx.db
          .update(s.jobs)
          .set({
            status: "needs-attention",
            errorCode: "SUBMISSION_UNCERTAIN",
            leaseOwner: null,
            leaseUntil: null,
            updatedAt: now(),
          })
          .where(eq(s.jobs.id, job.id))
          .run();
        const p = job.payload as Payload;
        if (p.previewId)
          ctx.db
            .update(s.previews)
            .set({ status: "needs-attention" })
            .where(eq(s.previews.id, p.previewId))
            .run();
        return null;
      }
      ctx.db
        .update(s.jobs)
        .set({
          status: job.providerTaskId || job.kind !== "render" ? "running" : "uploading",
          leaseOwner,
          leaseUntil: new Date(Date.now() + 240_000).toISOString(),
          attempts: job.attempts + 1,
          updatedAt: now(),
        })
        .where(eq(s.jobs.id, job.id))
        .run();
      return ctx.db.select().from(s.jobs).where(eq(s.jobs.id, job.id)).get()!;
    })
    .immediate();
  if (!claimed) return false;
  const payload = claimed.payload as Payload;
  const owns = () => {
    const j = ctx.db.select().from(s.jobs).where(eq(s.jobs.id, claimed.id)).get();
    return j?.leaseOwner === leaseOwner && !["cancelled", "failed"].includes(j.status);
  };
  const patch = (value: Partial<typeof s.jobs.$inferInsert>) =>
    ctx.db
      .update(s.jobs)
      .set({ ...value, updatedAt: now() })
      .where(and(eq(s.jobs.id, claimed.id), eq(s.jobs.leaseOwner, leaseOwner)))
      .run();
  if (claimed.kind === "healthcheck") {
    patch({ status: "success", leaseOwner: null, leaseUntil: null });
    return true;
  }
  if (claimed.kind === "plan") {
    if (payload.reviewPolicyVersion && payload.reviewPolicyVersion !== TRANSFORM_VERSION) {
      patch({
        status: "needs-attention",
        errorCode: "WORKER_POLICY_CHANGED",
        leaseOwner: null,
        leaseUntil: null,
      });
      return true;
    }
    const event = ctx.db.select().from(s.events).where(eq(s.events.id, payload.eventId!)).get();
    if (!event || event.archived || event.revision !== payload.eventRevision) {
      patch({
        status: "needs-attention",
        errorCode: "INPUTS_CHANGED",
        leaseOwner: null,
        leaseUntil: null,
      });
      return true;
    }
    const input = planningInput(ctx, event.id, payload.locks || {}, payload.baseline || {});
    const result = solve(input, { cancelled: () => !owns() });
    ctx.sqlite
      .transaction(() => {
        if (!owns()) return;
        const currentEvent = ctx.db.select().from(s.events).where(eq(s.events.id, event.id)).get()!;
        const stale = currentEvent.revision !== payload.eventRevision;
        if (!stale) bumpEvent(ctx, event.id, "plan.completed", claimed.id);
        ctx.db
          .insert(s.plans)
          .values({
            id: claimed.id,
            eventId: event.id,
            eventRevision: payload.eventRevision!,
            status: result.status,
            snapshot: { input, result },
            totalMinor: result.totalMinor,
            stale,
            createdAt: now(),
          })
          .run();
        patch({ status: "success", leaseOwner: null, leaseUntil: null });
      })
      .immediate();
    return true;
  }
  const files = dependencies.files || new PrivateFiles();
  const preview = ctx.db
    .select()
    .from(s.previews)
    .where(eq(s.previews.id, payload.previewId!))
    .get();
  const valid = () => {
    if (!preview || !owns()) return false;
    const p = ctx.db.select().from(s.previews).where(eq(s.previews.id, preview.id)).get()!;
    const team = ctx.db.select().from(s.teams).where(eq(s.teams.id, p.teamId!)).get();
    const design = ctx.db.select().from(s.designs).where(eq(s.designs.id, p.designId)).get();
    const event = ctx.db.select().from(s.events).where(eq(s.events.id, p.eventId)).get();
    return (
      !p.stale &&
      p.status !== "deleted" &&
      !event?.archived &&
      team?.personAssetId === p.personAssetId &&
      design?.assetId === p.referenceAssetId &&
      design?.revision === p.designRevision &&
      [p.personAssetId, p.referenceAssetId].every((id) => {
        const a = ctx.db.select().from(s.assets).where(eq(s.assets.id, id)).get();
        return a && !a.deletedAt;
      })
    );
  };
  const invalidateJob = () => {
    if (!valid()) {
      if (!owns()) return true;
      patch({
        status: "cancelled",
        errorCode: "INPUTS_CHANGED",
        leaseOwner: null,
        leaseUntil: null,
      });
      if (preview)
        ctx.db.update(s.previews).set({ stale: true }).where(eq(s.previews.id, preview.id)).run();
      return true;
    }
    return false;
  };
  try {
    if (invalidateJob()) return true;
    const api = dependencies.client || new YouCamClient(process.env.YOUCAM_API_KEY || "");
    let taskId = claimed.providerTaskId;
    if (!taskId) {
      const src = ctx.db
        .select()
        .from(s.assets)
        .where(eq(s.assets.id, preview!.personAssetId))
        .get()!;
      const ref = ctx.db
        .select()
        .from(s.assets)
        .where(eq(s.assets.id, preview!.referenceAssetId))
        .get()!;
      const sourceBytes = await files.read(src.relativePath),
        referenceBytes = await files.read(ref.relativePath);
      if (
        createHash("sha256").update(sourceBytes).digest("hex") !== src.sha256 ||
        createHash("sha256").update(referenceBytes).digest("hex") !== ref.sha256
      )
        throw new ProviderError("INPUT_FILE_CHANGED");
      const sourceId = await api.upload(sourceBytes, "person.jpg");
      if (invalidateJob()) return true;
      const referenceId = await api.upload(referenceBytes, "shirt.jpg");
      if (invalidateJob()) return true;
      patch({ status: "submitting" });
      ctx.db
        .update(s.previews)
        .set({ status: "submitting" })
        .where(eq(s.previews.id, preview!.id))
        .run();
      taskId = await api.submit(sourceId, referenceId);
      ctx.db
        .update(s.jobs)
        .set({ providerTaskId: taskId, updatedAt: now() })
        .where(eq(s.jobs.id, claimed.id))
        .run();
      ctx.db
        .update(s.previews)
        .set({ providerTaskId: taskId })
        .where(eq(s.previews.id, preview!.id))
        .run();
      if (invalidateJob()) return true;
    }
    const result = await api.status(taskId);
    if (invalidateJob()) return true;
    if (result.status === "error") throw new ProviderError("PROVIDER_TASK_ERROR");
    if (result.status !== "success" || !result.url) {
      patch({
        status: "running",
        leaseOwner: null,
        leaseUntil: null,
        nextRunAt: new Date(Date.now() + 10_000).toISOString(),
        payload: { ...payload, failures: 0 },
      });
      ctx.db
        .update(s.previews)
        .set({ status: "running" })
        .where(eq(s.previews.id, preview!.id))
        .run();
      return true;
    }
    const bytes = await api.download(result.url);
    const normalized = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .jpeg({ quality: 95 })
      .toBuffer();
    const key = await files.put(normalized, "jpg");
    let kept = false;
    ctx.sqlite
      .transaction(() => {
        if (!valid()) return;
        const outputId = crypto.randomUUID();
        ctx.db
          .insert(s.assets)
          .values({
            id: outputId,
            eventId: preview!.eventId,
            kind: "output",
            relativePath: key,
            sha256: createHash("sha256").update(normalized).digest("hex"),
            mime: "image/jpeg",
            permission: {
              generatedBy: "YouCam Clothes V3",
              sourceAssets: [preview!.personAssetId, preview!.referenceAssetId],
            },
            createdAt: now(),
          })
          .run();
        ctx.db
          .update(s.previews)
          .set({ status: "success", outputAssetId: outputId, acceptance: "pending" })
          .where(eq(s.previews.id, preview!.id))
          .run();
        patch({ status: "success", leaseOwner: null, leaseUntil: null, errorCode: null });
        bumpEvent(ctx, preview!.eventId, "preview.completed", preview!.id);
        kept = true;
      })
      .immediate();
    if (!kept) {
      invalidateJob();
      await unlink(files.path(key)).catch(() => {});
    }
  } catch (error) {
    if (!owns()) return true;
    const code = error instanceof ProviderError ? error.code : "LOCAL_ASSET_ERROR";
    const failures = (payload.failures || 0) + 1;
    const knownTask = ctx.db
      .select()
      .from(s.jobs)
      .where(eq(s.jobs.id, claimed.id))
      .get()?.providerTaskId;
    const retryable =
      Boolean(knownTask) &&
      error instanceof ProviderError &&
      ([429, 500, 502, 503, 504].includes(error.httpStatus || 0) ||
        ["NETWORK_ERROR", "RESULT_DOWNLOAD_FAILED"].includes(code));
    const status =
      retryable && failures < 5
        ? "running"
        : code === "SUBMISSION_UNCERTAIN" || (knownTask && code !== "PROVIDER_TASK_ERROR")
          ? "needs-attention"
          : "failed";
    patch({
      status,
      errorCode: code,
      payload: { ...payload, failures },
      leaseOwner: null,
      leaseUntil: null,
      nextRunAt: new Date(Date.now() + Math.min(120_000, 10_000 * 2 ** failures)).toISOString(),
    });
    if (preview)
      ctx.db.update(s.previews).set({ status }).where(eq(s.previews.id, preview.id)).run();
  }
  return true;
}

import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { unlink } from "node:fs/promises";
import type { DatabaseContext } from "./db";
import * as s from "./db/schema";
import { PrivateFiles } from "./storage/private-files";
import { WorkspaceError } from "./workspace";
import {
  pipelineCommand,
  previewKey,
  TRANSFORM_VERSION,
  type ReviewEvidence,
} from "@/domain/pipeline";
import {
  bumpEvent,
  currentReview,
  eventAtRevision,
  stalePreviewReviews,
  usablePreview,
} from "./evidence";

export function readPipelineState(ctx: DatabaseContext, eventId: string) {
  const reviewPairs = new Set<string>();
  const previews = ctx.db
    .select()
    .from(s.previews)
    .where(eq(s.previews.eventId, eventId))
    .orderBy(desc(s.previews.createdAt))
    .all();
  const regionRows = previews.length
    ? ctx.db
        .select()
        .from(s.regions)
        .where(
          inArray(
            s.regions.previewId,
            previews.map((p) => p.id),
          ),
        )
        .all()
    : [];
  return {
    assets: ctx.db
      .select({
        id: s.assets.id,
        kind: s.assets.kind,
        permission: s.assets.permission,
        revision: s.assets.revision,
        deletedAt: s.assets.deletedAt,
      })
      .from(s.assets)
      .where(eq(s.assets.eventId, eventId))
      .all(),
    previews: previews.map(
      ({ providerTaskId: _task, inputHash: _hash, parameters: _params, ...p }) => ({
        ...p,
        usable: Boolean(usablePreview(ctx, p.id, eventId)),
        region:
          regionRows
            .filter((r) => r.previewId === p.id)
            .sort((a, b) => b.revision - a.revision)[0] || null,
      }),
    ),
    reviews: ctx.db
      .select()
      .from(s.reviews)
      .where(eq(s.reviews.eventId, eventId))
      .orderBy(desc(s.reviews.createdAt), desc(s.reviews.revision))
      .all()
      .map((r) => {
        const key = `${r.fixtureId}:${r.optionA}:${r.optionB}`;
        const current = !reviewPairs.has(key) && currentReview(ctx, r);
        reviewPairs.add(key);
        return { ...r, current };
      }),
    plans: ctx.db
      .select()
      .from(s.plans)
      .where(eq(s.plans.eventId, eventId))
      .orderBy(desc(s.plans.createdAt))
      .all(),
    jobs: ctx.db
      .select()
      .from(s.jobs)
      .all()
      .filter((j) => (j.payload as { eventId?: string }).eventId === eventId)
      .map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        hasProviderTask: Boolean(j.providerTaskId),
        errorCode: j.errorCode,
        attempts: j.attempts,
        estimatedUnits: j.estimatedUnits,
        updatedAt: j.updatedAt,
      })),
    workerHeartbeat:
      ctx.db
        .select()
        .from(s.runtimeSettings)
        .where(eq(s.runtimeSettings.key, "workerHeartbeat"))
        .get()?.value || null,
    workerMode:
      ctx.db.select().from(s.runtimeSettings).where(eq(s.runtimeSettings.key, "workerMode")).get()
        ?.value || "all",
    unitLimit: Number(process.env.MATCHCLEAR_API_UNIT_LIMIT || 40),
  };
}
export type PipelineState = ReturnType<typeof readPipelineState>;

export async function storePhoto(ctx: DatabaseContext, form: FormData, files = new PrivateFiles()) {
  const eventId = String(form.get("eventId") || "");
  const revision = Number(form.get("revision"));
  const kind = String(form.get("kind"));
  const targetId = String(form.get("targetId") || "");
  const basis = String(form.get("basis") || "").trim();
  if (
    !["person", "reference"].includes(kind) ||
    form.get("permission") !== "true" ||
    basis.length < 5 ||
    basis.length > 300 ||
    (kind === "person" && form.get("adult") !== "true")
  )
    throw new WorkspaceError(
      "Confirm permission, its basis, and an adult subject for a person photo.",
    );
  eventAtRevision(ctx, eventId, revision);
  const upload = form.get("photo");
  if (!(upload instanceof File) || upload.size > 10_000_000 || !upload.size)
    throw new WorkspaceError("Use a JPEG or PNG smaller than 10 MB.");
  const bytes = Buffer.from(await upload.arrayBuffer());
  let normalized: Buffer;
  try {
    const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (
      !["jpeg", "png"].includes(meta.format || "") ||
      Math.min(meta.width || 0, meta.height || 0) < 384
    )
      throw new Error("Invalid photo");
    normalized = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .jpeg({ quality: 93 })
      .toBuffer();
  } catch {
    throw new WorkspaceError(
      "This file is not a supported photo. Use a JPEG or PNG with both sides at least 384 pixels.",
    );
  }
  const key = await files.put(normalized, "jpg");
  try {
    return ctx.sqlite
      .transaction(() => {
        eventAtRevision(ctx, eventId, revision);
        const team =
          kind === "person"
            ? ctx.db
                .select()
                .from(s.teams)
                .where(and(eq(s.teams.id, targetId), eq(s.teams.eventId, eventId)))
                .get()
            : null;
        const design =
          kind === "reference"
            ? ctx.db
                .select()
                .from(s.designs)
                .where(and(eq(s.designs.id, targetId), eq(s.designs.eventId, eventId)))
                .get()
            : null;
        if (!team && !design) throw new WorkspaceError("Choose a target from this event.");
        const id = crypto.randomUUID();
        ctx.db
          .insert(s.assets)
          .values({
            id,
            eventId,
            kind,
            relativePath: key,
            sha256: createHash("sha256").update(normalized).digest("hex"),
            mime: "image/jpeg",
            permission: {
              basis,
              uploadName: upload.name.slice(0, 120),
              adultConfirmed: kind === "person",
              permissionConfirmed: true,
            },
            createdAt: new Date().toISOString(),
          })
          .run();
        if (team)
          ctx.db
            .update(s.teams)
            .set({ personAssetId: id, revision: team.revision + 1 })
            .where(eq(s.teams.id, team.id))
            .run();
        if (design)
          ctx.db
            .update(s.designs)
            .set({ assetId: id, imageKind: "photograph", revision: design.revision + 1 })
            .where(eq(s.designs.id, design.id))
            .run();
        const affected = ctx.db
          .select()
          .from(s.previews)
          .where(eq(s.previews.eventId, eventId))
          .all()
          .filter((p) => (team ? p.teamId === team.id : p.designId === design!.id));
        if (affected.length)
          ctx.db
            .update(s.previews)
            .set({ stale: true })
            .where(
              inArray(
                s.previews.id,
                affected.map((p) => p.id),
              ),
            )
            .run();
        stalePreviewReviews(
          ctx,
          eventId,
          affected.map((p) => p.id),
          "A source photo changed.",
        );
        bumpEvent(ctx, eventId, "photo.uploaded", id, { kind, targetId });
        return { eventId, assetId: id };
      })
      .immediate();
  } catch (error) {
    await unlink(files.path(key)).catch(() => {});
    throw error;
  }
}

export function applyPipeline(ctx: DatabaseContext, raw: unknown) {
  const parsed = pipelineCommand.safeParse(raw);
  if (!parsed.success)
    throw new WorkspaceError(parsed.error.issues.map((e) => e.message).join("; "));
  const cmd = parsed.data;
  return ctx.sqlite
    .transaction(() => {
      eventAtRevision(ctx, cmd.eventId, cmd.revision);
      const now = new Date().toISOString();
      let entityId = cmd.eventId;
      const cleanup: string[] = [];
      let changed = true;
      if (cmd.op === "queuePreviews") {
        changed = false;
        if (!process.env.YOUCAM_API_KEY?.trim())
          throw new WorkspaceError("Configure the server API key before queuing a render.");
        let reserved = ctx.db
          .select()
          .from(s.usage)
          .all()
          .reduce((n, row) => n + row.estimatedUnits, 0);
        const limit = Number(process.env.MATCHCLEAR_API_UNIT_LIMIT || 40);
        for (const item of cmd.items) {
          const team = ctx.db
            .select()
            .from(s.teams)
            .where(and(eq(s.teams.id, item.teamId), eq(s.teams.eventId, cmd.eventId)))
            .get();
          const design = ctx.db
            .select()
            .from(s.designs)
            .where(and(eq(s.designs.id, item.designId), eq(s.designs.eventId, cmd.eventId)))
            .get();
          const option = ctx.db
            .select()
            .from(s.options)
            .where(
              and(
                eq(s.options.eventId, cmd.eventId),
                eq(s.options.teamId, item.teamId),
                eq(s.options.designId, item.designId),
              ),
            )
            .get();
          if (!team?.personAssetId || !design?.assetId || !option)
            throw new WorkspaceError(
              "Each queued option needs an assigned team, person photo and garment reference.",
            );
          const person = ctx.db
            .select()
            .from(s.assets)
            .where(eq(s.assets.id, team.personAssetId))
            .get();
          const reference = ctx.db
            .select()
            .from(s.assets)
            .where(eq(s.assets.id, design.assetId))
            .get();
          if (
            !person ||
            !reference ||
            person.deletedAt ||
            reference.deletedAt ||
            person.eventId !== cmd.eventId ||
            reference.eventId !== cmd.eventId
          )
            throw new WorkspaceError("A source photo is unavailable.");
          const hash = createHash("sha256")
            .update(
              previewKey(team.id, design.id, person.sha256, reference.sha256, design.revision),
            )
            .digest("hex");
          const previous = ctx.db
            .select()
            .from(s.previews)
            .where(and(eq(s.previews.eventId, cmd.eventId), eq(s.previews.inputHash, hash)))
            .orderBy(desc(s.previews.createdAt))
            .all();
          if (
            previous.some(
              (p) =>
                !p.stale &&
                [
                  "queued",
                  "uploading",
                  "submitting",
                  "running",
                  "success",
                  "needs-attention",
                ].includes(p.status),
            )
          )
            continue;
          if (previous.length && !cmd.retryFailed)
            throw new WorkspaceError(
              "A previous attempt failed or was cancelled. Tick the explicit retry option to reserve another render.",
            );
          if (!Number.isFinite(limit) || reserved + 2 > limit)
            throw new WorkspaceError(
              "This batch exceeds the configured unit allowance. No new tasks in this batch were queued.",
            );
          reserved += 2;
          changed = true;
          const id = crypto.randomUUID();
          const jobId = crypto.randomUUID();
          ctx.db
            .insert(s.previews)
            .values({
              id,
              eventId: cmd.eventId,
              teamId: team.id,
              designId: design.id,
              designRevision: design.revision,
              personAssetId: person.id,
              referenceAssetId: reference.id,
              inputHash: hash,
              apiVersion: "v3",
              parameters: { garment_category: "upper_body", change_shoes: false },
              status: "queued",
              createdAt: now,
            })
            .run();
          ctx.db
            .insert(s.jobs)
            .values({
              id: jobId,
              kind: "render",
              status: "queued",
              payload: { eventId: cmd.eventId, previewId: id },
              estimatedUnits: 2,
              createdAt: now,
              updatedAt: now,
              nextRunAt: now,
            })
            .run();
          ctx.db
            .insert(s.usage)
            .values({
              id: crypto.randomUUID(),
              jobId,
              estimatedUnits: 2,
              confirmedUnits: null,
              createdAt: now,
            })
            .run();
          entityId = id;
        }
      } else if (cmd.op === "acceptPreview") {
        const preview = ctx.db
          .select()
          .from(s.previews)
          .where(and(eq(s.previews.id, cmd.previewId), eq(s.previews.eventId, cmd.eventId)))
          .get();
        if (!preview || preview.stale || preview.status !== "success" || !preview.outputAssetId)
          throw new WorkspaceError(
            "Only a current completed render can be inspected and accepted.",
          );
        ctx.db
          .update(s.previews)
          .set({
            acceptance: cmd.acceptance,
            acceptanceReason: cmd.reason,
            reviewer: cmd.reviewer,
            revision: preview.revision + 1,
          })
          .where(eq(s.previews.id, preview.id))
          .run();
        stalePreviewReviews(ctx, cmd.eventId, [preview.id], "The appearance acceptance changed.");
        entityId = preview.id;
      } else if (cmd.op === "saveRegion") {
        if (!usablePreview(ctx, cmd.previewId, cmd.eventId))
          throw new WorkspaceError(
            "Accept the current preview's appearance before marking its shirt area.",
          );
        const prior = ctx.db
          .select()
          .from(s.regions)
          .where(eq(s.regions.previewId, cmd.previewId))
          .orderBy(desc(s.regions.revision))
          .get();
        if (prior)
          ctx.db
            .update(s.regions)
            .set({
              polygon: cmd.polygon,
              transformVersion: TRANSFORM_VERSION,
              revision: prior.revision + 1,
            })
            .where(eq(s.regions.id, prior.id))
            .run();
        else
          ctx.db
            .insert(s.regions)
            .values({
              id: crypto.randomUUID(),
              previewId: cmd.previewId,
              polygon: cmd.polygon,
              transformVersion: TRANSFORM_VERSION,
            })
            .run();
        stalePreviewReviews(ctx, cmd.eventId, [cmd.previewId], "The marked shirt area changed.");
        entityId = cmd.previewId;
      } else if (cmd.op === "reviewPair") {
        const fixture = ctx.db
          .select()
          .from(s.fixtures)
          .where(and(eq(s.fixtures.id, cmd.fixtureId), eq(s.fixtures.eventId, cmd.eventId)))
          .get();
        const a = usablePreview(ctx, cmd.previewA, cmd.eventId, true),
          b = usablePreview(ctx, cmd.previewB, cmd.eventId, true);
        const oa = ctx.db.select().from(s.options).where(eq(s.options.id, cmd.optionA)).get(),
          ob = ctx.db.select().from(s.options).where(eq(s.options.id, cmd.optionB)).get();
        if (
          !fixture ||
          !a ||
          !b ||
          !oa ||
          !ob ||
          oa.eventId !== cmd.eventId ||
          ob.eventId !== cmd.eventId ||
          oa.teamId !== fixture.teamA ||
          ob.teamId !== fixture.teamB ||
          a.preview.teamId !== oa.teamId ||
          b.preview.teamId !== ob.teamId ||
          a.design.id !== oa.designId ||
          b.design.id !== ob.designId
        )
          throw new WorkspaceError(
            "Choose current, accepted previews and confirmed shirt areas for the two opposing teams.",
          );
        const evidence: ReviewEvidence = {
          previewA: a.preview.id,
          previewB: b.preview.id,
          revisionA: a.preview.revision,
          revisionB: b.preview.revision,
          regionA: a.region!.id,
          regionB: b.region!.id,
          regionRevisionA: a.region!.revision,
          regionRevisionB: b.region!.revision,
          designRevisionA: a.design.revision,
          designRevisionB: b.design.revision,
          transformVersion: TRANSFORM_VERSION,
          viewedModes: cmd.viewedModes,
        };
        entityId = crypto.randomUUID();
        ctx.db
          .insert(s.reviews)
          .values({
            id: entityId,
            eventId: cmd.eventId,
            fixtureId: fixture.id,
            optionA: oa.id,
            optionB: ob.id,
            status: cmd.status,
            reviewer: cmd.reviewer,
            reason: cmd.reason,
            evidence,
            revision: cmd.revision + 1,
            createdAt: now,
          })
          .run();
      } else if (cmd.op === "queuePlan") {
        for (const mapping of [cmd.locks, cmd.baseline])
          for (const [teamId, optionId] of Object.entries(mapping))
            if (
              !ctx.db
                .select()
                .from(s.options)
                .where(
                  and(
                    eq(s.options.id, optionId),
                    eq(s.options.teamId, teamId),
                    eq(s.options.eventId, cmd.eventId),
                  ),
                )
                .get()
            )
              throw new WorkspaceError(
                "A lock or baseline refers to an option outside this event/team.",
              );
        entityId = crypto.randomUUID();
        // The worker verifies this exact input revision before publishing a result.
        ctx.db
          .insert(s.jobs)
          .values({
            id: entityId,
            kind: "plan",
            status: "queued",
            payload: {
              eventId: cmd.eventId,
              locks: cmd.locks,
              baseline: cmd.baseline,
              eventRevision: cmd.revision + 1,
            },
            createdAt: now,
            updatedAt: now,
            nextRunAt: now,
          })
          .run();
      } else if (cmd.op === "cancelJob" || cmd.op === "resumeJob") {
        const job = ctx.db.select().from(s.jobs).where(eq(s.jobs.id, cmd.jobId)).get();
        if (!job || (job.payload as { eventId?: string }).eventId !== cmd.eventId)
          throw new WorkspaceError("Job not found in this event.");
        const previewId = (job.payload as { previewId?: string }).previewId;
        if (cmd.op === "resumeJob") {
          if (!job.providerTaskId || !["needs-attention", "running"].includes(job.status))
            throw new WorkspaceError(
              "Only a known provider task awaiting attention can resume. An uncertain submission cannot be repeated automatically.",
            );
          ctx.db
            .update(s.jobs)
            .set({
              status: "running",
              errorCode: null,
              nextRunAt: now,
              leaseUntil: null,
              leaseOwner: null,
              updatedAt: now,
            })
            .where(eq(s.jobs.id, job.id))
            .run();
          if (previewId)
            ctx.db
              .update(s.previews)
              .set({ status: "running" })
              .where(eq(s.previews.id, previewId))
              .run();
        } else {
          if (["success", "failed", "cancelled"].includes(job.status))
            throw new WorkspaceError("This job has already finished.");
          ctx.db
            .update(s.jobs)
            .set({ status: "cancelled", leaseOwner: null, leaseUntil: null, updatedAt: now })
            .where(eq(s.jobs.id, job.id))
            .run();
          if (job.status === "queued")
            ctx.db
              .update(s.usage)
              .set({ estimatedUnits: 0 })
              .where(eq(s.usage.jobId, job.id))
              .run();
          if (previewId)
            ctx.db
              .update(s.previews)
              .set({ status: "cancelled" })
              .where(eq(s.previews.id, previewId))
              .run();
        }
        entityId = job.id;
      } else if (cmd.op === "deleteAsset") {
        const asset = ctx.db
          .select()
          .from(s.assets)
          .where(and(eq(s.assets.id, cmd.assetId), eq(s.assets.eventId, cmd.eventId)))
          .get();
        if (!asset || asset.deletedAt) throw new WorkspaceError("This photo is unavailable.");
        const affected = ctx.db
          .select()
          .from(s.previews)
          .where(eq(s.previews.eventId, cmd.eventId))
          .all()
          .filter((p) => [p.personAssetId, p.referenceAssetId, p.outputAssetId].includes(asset.id));
        const outputIds = affected
          .map((p) => p.outputAssetId)
          .filter((id): id is string => Boolean(id));
        for (const id of new Set([asset.id, ...outputIds])) {
          const row = ctx.db.select().from(s.assets).where(eq(s.assets.id, id)).get();
          if (row && !row.deletedAt) {
            cleanup.push(row.relativePath);
            ctx.db
              .update(s.assets)
              .set({ deletedAt: now, revision: row.revision + 1 })
              .where(eq(s.assets.id, id))
              .run();
          }
        }
        for (const p of affected)
          ctx.db
            .update(s.previews)
            .set({ stale: true, status: "deleted" })
            .where(eq(s.previews.id, p.id))
            .run();
        for (const job of ctx.db.select().from(s.jobs).all())
          if (
            affected.some((p) => p.id === (job.payload as { previewId?: string }).previewId) &&
            !["success", "failed"].includes(job.status)
          )
            ctx.db
              .update(s.jobs)
              .set({ status: "cancelled", leaseOwner: null, leaseUntil: null, updatedAt: now })
              .where(eq(s.jobs.id, job.id))
              .run();
        stalePreviewReviews(
          ctx,
          cmd.eventId,
          affected.map((p) => p.id),
          "A photo was deleted locally.",
        );
        entityId = asset.id;
      }
      if (changed) bumpEvent(ctx, cmd.eventId, cmd.op, entityId);
      return { eventId: cmd.eventId, cleanup };
    })
    .immediate();
}

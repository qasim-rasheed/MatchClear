import { and, desc, eq } from "drizzle-orm";
import type { DatabaseContext } from "./db";
import * as s from "./db/schema";
import { TRANSFORM_VERSION, type ReviewEvidence } from "@/domain/pipeline";
import { WorkspaceError } from "./workspace";

export function eventAtRevision(ctx: DatabaseContext, eventId: string, revision: number) {
  const event = ctx.db.select().from(s.events).where(eq(s.events.id, eventId)).get();
  if (!event || event.archived) throw new WorkspaceError("This event is unavailable.", 404);
  if (event.revision !== revision)
    throw new WorkspaceError(
      "This event changed. Refresh saved data before applying this action.",
      409,
    );
  return event;
}
export function bumpEvent(
  ctx: DatabaseContext,
  eventId: string,
  action: string,
  entityId: string,
  detail: Record<string, unknown> = {},
) {
  const event = ctx.db.select().from(s.events).where(eq(s.events.id, eventId)).get()!;
  const now = new Date().toISOString();
  ctx.db
    .update(s.events)
    .set({ revision: event.revision + 1, updatedAt: now })
    .where(eq(s.events.id, eventId))
    .run();
  ctx.db.update(s.plans).set({ stale: true }).where(eq(s.plans.eventId, eventId)).run();
  ctx.db
    .insert(s.activity)
    .values({ id: crypto.randomUUID(), eventId, action, entityId, detail, createdAt: now })
    .run();
}
export function stalePreviewReviews(
  ctx: DatabaseContext,
  eventId: string,
  ids: string[],
  reason: string,
) {
  for (const review of ctx.db
    .select()
    .from(s.reviews)
    .where(eq(s.reviews.eventId, eventId))
    .all()) {
    const e = review.evidence as Partial<ReviewEvidence>;
    if (ids.includes(e.previewA || "") || ids.includes(e.previewB || ""))
      ctx.db
        .update(s.reviews)
        .set({ status: "stale", staleReason: reason, revision: review.revision + 1 })
        .where(eq(s.reviews.id, review.id))
        .run();
  }
}
export function usablePreview(
  ctx: DatabaseContext,
  previewId: string,
  eventId: string,
  requireRegion = false,
) {
  const preview = ctx.db
    .select()
    .from(s.previews)
    .where(and(eq(s.previews.id, previewId), eq(s.previews.eventId, eventId)))
    .get();
  if (
    !preview ||
    preview.stale ||
    preview.status !== "success" ||
    preview.acceptance !== "accepted" ||
    !preview.outputAssetId ||
    !preview.teamId
  )
    return null;
  const design = ctx.db.select().from(s.designs).where(eq(s.designs.id, preview.designId)).get();
  const team = ctx.db.select().from(s.teams).where(eq(s.teams.id, preview.teamId)).get();
  if (
    !design ||
    !team ||
    design.revision !== preview.designRevision ||
    design.assetId !== preview.referenceAssetId ||
    team.personAssetId !== preview.personAssetId
  )
    return null;
  for (const id of [preview.personAssetId, preview.referenceAssetId, preview.outputAssetId])
    if (
      !ctx.db
        .select()
        .from(s.assets)
        .where(and(eq(s.assets.id, id), eq(s.assets.eventId, eventId)))
        .get() ||
      ctx.db.select().from(s.assets).where(eq(s.assets.id, id)).get()!.deletedAt
    )
      return null;
  const region = ctx.db
    .select()
    .from(s.regions)
    .where(eq(s.regions.previewId, preview.id))
    .orderBy(desc(s.regions.revision))
    .get();
  if (requireRegion && (!region || region.transformVersion !== TRANSFORM_VERSION)) return null;
  return { preview, design, team, region };
}
export function currentReview(ctx: DatabaseContext, review: typeof s.reviews.$inferSelect) {
  const e = review.evidence as Partial<ReviewEvidence>;
  if (
    review.status === "stale" ||
    e.transformVersion !== TRANSFORM_VERSION ||
    !e.previewA ||
    !e.previewB
  )
    return false;
  const a = usablePreview(ctx, e.previewA, review.eventId, true),
    b = usablePreview(ctx, e.previewB, review.eventId, true);
  const optionA = ctx.db.select().from(s.options).where(eq(s.options.id, review.optionA)).get();
  const optionB = ctx.db.select().from(s.options).where(eq(s.options.id, review.optionB)).get();
  return Boolean(
    a &&
    b &&
    optionA &&
    optionB &&
    a.preview.designId === optionA.designId &&
    b.preview.designId === optionB.designId &&
    a.preview.teamId === optionA.teamId &&
    b.preview.teamId === optionB.teamId &&
    e.revisionA === a.preview.revision &&
    e.revisionB === b.preview.revision &&
    e.regionA === a.region!.id &&
    e.regionB === b.region!.id &&
    e.regionRevisionA === a.region!.revision &&
    e.regionRevisionB === b.region!.revision &&
    e.designRevisionA === a.design.revision &&
    e.designRevisionB === b.design.revision,
  );
}

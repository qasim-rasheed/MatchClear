import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseContext } from "./db";
import * as s from "./db/schema";
import { eventAtRevision, currentReview, usablePreview } from "./evidence";
import { WorkspaceError } from "./workspace";
import { planningInput } from "../worker/process";
import type { PlanResult, PlanningInput } from "../lib/planner/solve";
import { quoteOption } from "../domain/validation";

export type BriefSnapshot = {
  version: 1;
  event: { id: string; name: string; currency: string; budgetMinor: number; revision: number };
  planId: string;
  confirmedBy: string;
  confirmedAt: string;
  totalMinor: number;
  optimality: string;
  includePlayerPhotos: boolean;
  lines: {
    teamId: string;
    team: string;
    optionId: string;
    designId: string;
    design: string;
    owned: boolean;
    quantities: Record<string, number>;
    extras: Record<string, number>;
    orderQuantity: number;
    unitMinor: number;
    setupMinor: number;
    totalMinor: number;
    seller: string;
    priceDate: string;
    illustrative: boolean;
    referenceAssetId: string;
    previewAssetId?: string;
  }[];
  fixtures: {
    id: string;
    label: string;
    teamA: string;
    teamB: string;
    designA: string;
    designB: string;
    reviewId: string;
    reviewer: string;
    reason: string;
    reviewedAt: string;
  }[];
  limitations: string[];
};
const commandSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("confirmPlan"),
    eventId: z.string(),
    revision: z.number().int(),
    planId: z.string(),
    reviewer: z.string().trim().min(2).max(80),
  }),
  z.object({
    op: z.literal("createBrief"),
    eventId: z.string(),
    revision: z.number().int(),
    confirmationId: z.string(),
    includePlayerPhotos: z.boolean().default(false),
  }),
]);
function snapshotForPlan(
  ctx: DatabaseContext,
  eventId: string,
  planId: string,
  reviewer: string,
): BriefSnapshot {
  const event = ctx.db.select().from(s.events).where(eq(s.events.id, eventId)).get()!;
  const plan = ctx.db
    .select()
    .from(s.plans)
    .where(and(eq(s.plans.id, planId), eq(s.plans.eventId, eventId)))
    .get();
  if (!plan || plan.stale || !["optimal", "feasible"].includes(plan.status))
    throw new WorkspaceError("Choose a current complete plan before confirming.");
  const { input, result } = plan.snapshot as { input: PlanningInput; result: PlanResult };
  if (!result.selection) throw new WorkspaceError("This run has no complete selection.");
  // Recheck the exact saved planning inputs, even when a stale flag was missed.
  const current = planningInput(ctx, eventId, input.locks, input.baseline);
  if (JSON.stringify(current) !== JSON.stringify(input))
    throw new WorkspaceError("Planning evidence changed. Run the planner again.", 409);
  const lines = current.teams.map((team) => {
    const option = ctx.db
      .select()
      .from(s.options)
      .where(eq(s.options.id, result.selection![team.id]))
      .get()!;
    const design = ctx.db.select().from(s.designs).where(eq(s.designs.id, option.designId)).get()!;
    const row = ctx.db.select().from(s.teams).where(eq(s.teams.id, team.id)).get()!;
    const quote = quoteOption(option, row.quantities);
    const preview = ctx.db
      .select()
      .from(s.previews)
      .where(and(eq(s.previews.teamId, team.id), eq(s.previews.designId, design.id)))
      .all()
      .find((p) => usablePreview(ctx, p.id, eventId, true));
    if (!preview || !quote.eligible || quote.minimumOrderNeedsSizes || !design.assetId)
      throw new WorkspaceError("A selected shirt no longer has complete evidence or stock.", 409);
    return {
      teamId: team.id,
      team: team.name,
      optionId: option.id,
      designId: design.id,
      design: design.name,
      owned: option.owned,
      quantities: row.quantities,
      extras: option.extraQuantities,
      orderQuantity: quote.orderQuantity,
      unitMinor: option.unitMinor,
      setupMinor: option.setupMinor,
      totalMinor: quote.totalMinor,
      seller: option.seller,
      priceDate: option.priceDate,
      illustrative: option.illustrative,
      referenceAssetId: design.assetId,
      previewAssetId: preview.outputAssetId!,
    };
  });
  const allReviews = ctx.db
    .select()
    .from(s.reviews)
    .where(eq(s.reviews.eventId, eventId))
    .orderBy(desc(s.reviews.createdAt), desc(s.reviews.revision))
    .all();
  const fixtures = current.fixtures.map((fixture) => {
    const a = lines.find((l) => l.teamId === fixture.teamA)!,
      b = lines.find((l) => l.teamId === fixture.teamB)!;
    const review = allReviews.find(
      (r) => r.fixtureId === fixture.id && r.optionA === a.optionId && r.optionB === b.optionId,
    );
    if (!review || review.status !== "approved" || !currentReview(ctx, review))
      throw new WorkspaceError("An opposing combination needs a current approval.", 409);
    return {
      id: fixture.id,
      label: fixture.label,
      teamA: a.team,
      teamB: b.team,
      designA: a.design,
      designB: b.design,
      reviewId: review.id,
      reviewer: review.reviewer,
      reason: review.reason,
      reviewedAt: review.createdAt,
    };
  });
  const totalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0);
  if (totalMinor !== result.totalMinor || totalMinor > event.budgetMinor)
    throw new WorkspaceError("Plan cost changed. Recompute before confirming.", 409);
  return {
    version: 1,
    event: {
      id: eventId,
      name: event.name,
      currency: event.currency,
      budgetMinor: event.budgetMinor,
      revision: event.revision,
    },
    planId,
    confirmedBy: reviewer,
    confirmedAt: new Date().toISOString(),
    totalMinor,
    optimality: result.status,
    includePlayerPhotos: true,
    lines,
    fixtures,
    limitations: [
      "Recorded screen reviews support a decision; they do not certify physical colour, fit or on-field accessibility.",
      "Seller, prices and stock are supplied records, not live retailer confirmation. Verify before ordering.",
      "One fixed shirt per team across these fixtures. This document is an order brief, not a placed order.",
    ],
  };
}
export function orderCommand(ctx: DatabaseContext, raw: unknown) {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) throw new WorkspaceError("Check the confirmation or export fields.");
  const cmd = parsed.data;
  return ctx.sqlite
    .transaction(() => {
      eventAtRevision(ctx, cmd.eventId, cmd.revision);
      let id: string;
      if (cmd.op === "confirmPlan") {
        const snapshot = snapshotForPlan(ctx, cmd.eventId, cmd.planId, cmd.reviewer);
        const existing = ctx.db
          .select()
          .from(s.confirmations)
          .where(eq(s.confirmations.planId, cmd.planId))
          .get();
        if (existing) return { eventId: cmd.eventId, id: existing.id };
        id = crypto.randomUUID();
        ctx.db
          .insert(s.confirmations)
          .values({
            id,
            eventId: cmd.eventId,
            planId: cmd.planId,
            reviewer: cmd.reviewer,
            snapshot,
            createdAt: snapshot.confirmedAt,
          })
          .run();
      } else {
        const confirmation = ctx.db
          .select()
          .from(s.confirmations)
          .where(
            and(
              eq(s.confirmations.id, cmd.confirmationId),
              eq(s.confirmations.eventId, cmd.eventId),
            ),
          )
          .get();
        if (!confirmation) throw new WorkspaceError("Choose a confirmed plan.");
        const plan = ctx.db.select().from(s.plans).where(eq(s.plans.id, confirmation.planId)).get();
        if (!plan || plan.stale)
          throw new WorkspaceError(
            "The confirmed plan is outdated. Recompute and confirm a new plan.",
            409,
          );
        const snapshot = structuredClone(confirmation.snapshot as BriefSnapshot);
        snapshot.includePlayerPhotos = cmd.includePlayerPhotos;
        if (!cmd.includePlayerPhotos)
          snapshot.lines.forEach((line) => {
            delete line.previewAssetId;
          });
        id = crypto.randomUUID();
        ctx.db
          .insert(s.exportsTable)
          .values({
            id,
            planId: confirmation.planId,
            snapshot,
            createdAt: new Date().toISOString(),
          })
          .run();
      }
      // Confirmation/export changes no planning inputs, so it does not stale its own plan.
      ctx.db
        .insert(s.activity)
        .values({
          id: crypto.randomUUID(),
          eventId: cmd.eventId,
          action: cmd.op,
          entityId: id,
          detail: {},
          createdAt: new Date().toISOString(),
        })
        .run();
      return { eventId: cmd.eventId, id };
    })
    .immediate();
}

export function getBrief(ctx: DatabaseContext, eventId: string, id: string) {
  const event = ctx.db.select().from(s.events).where(eq(s.events.id, eventId)).get();
  const row = ctx.db.select().from(s.exportsTable).where(eq(s.exportsTable.id, id)).get();
  if (!event || event.archived || !row || (row.snapshot as BriefSnapshot).event.id !== eventId)
    throw new WorkspaceError("Order brief unavailable.", 404);
  const plan = ctx.db.select().from(s.plans).where(eq(s.plans.id, row.planId)).get();
  return { row, snapshot: row.snapshot as BriefSnapshot, outdated: !plan || plan.stale };
}

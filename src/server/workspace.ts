import { and, desc, eq } from "drizzle-orm";
import type { DatabaseContext } from "./db";
import * as s from "./db/schema";
import { mutationSchema, totalQuantity } from "@/domain/validation";

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function getWorkspace(ctx: DatabaseContext, eventId?: string | null) {
  const eventList = ctx.db
    .select()
    .from(s.events)
    .where(eq(s.events.archived, false))
    .orderBy(s.events.createdAt)
    .all();
  const event = eventId ? eventList.find((e) => e.id === eventId) : eventList[0];
  if (eventId && !event)
    throw new WorkspaceError("This event is unavailable. Choose another event.", 404);
  return {
    events: eventList,
    event: event ?? null,
    teams: event ? ctx.db.select().from(s.teams).where(eq(s.teams.eventId, event.id)).all() : [],
    fixtures: event
      ? ctx.db.select().from(s.fixtures).where(eq(s.fixtures.eventId, event.id)).all()
      : [],
    designs: event
      ? ctx.db.select().from(s.designs).where(eq(s.designs.eventId, event.id)).all()
      : [],
    options: event
      ? ctx.db.select().from(s.options).where(eq(s.options.eventId, event.id)).all()
      : [],
    reviews: event
      ? ctx.db.select().from(s.reviews).where(eq(s.reviews.eventId, event.id)).all()
      : [],
    previews: event
      ? ctx.db
          .select({ id: s.previews.id, status: s.previews.status, stale: s.previews.stale })
          .from(s.previews)
          .where(eq(s.previews.eventId, event.id))
          .all()
      : [],
    plans: event
      ? ctx.db
          .select({ id: s.plans.id, status: s.plans.status, stale: s.plans.stale })
          .from(s.plans)
          .where(eq(s.plans.eventId, event.id))
          .all()
      : [],
    activity: event
      ? ctx.db
          .select()
          .from(s.activity)
          .where(eq(s.activity.eventId, event.id))
          .orderBy(desc(s.activity.createdAt))
          .limit(20)
          .all()
      : [],
    integration: {
      configured: Boolean(process.env.YOUCAM_API_KEY?.trim()),
      liveValidated:
        ctx.db
          .select()
          .from(s.jobs)
          .where(and(eq(s.jobs.kind, "manual-feasibility"), eq(s.jobs.status, "success")))
          .all().length > 0,
      successfulTests: ctx.db
        .select()
        .from(s.jobs)
        .where(and(eq(s.jobs.kind, "manual-feasibility"), eq(s.jobs.status, "success")))
        .all().length,
      estimatedUnits: ctx.db
        .select()
        .from(s.usage)
        .all()
        .reduce((sum, entry) => sum + entry.estimatedUnits, 0),
      feature: "Clothes V3",
    },
  };
}
export type Workspace = ReturnType<typeof getWorkspace>;

function invalidate(ctx: DatabaseContext, eventId: string, reason: string, designId?: string) {
  ctx.db.update(s.plans).set({ stale: true }).where(eq(s.plans.eventId, eventId)).run();
  if (!designId) return;
  ctx.db
    .update(s.previews)
    .set({ stale: true })
    .where(and(eq(s.previews.eventId, eventId), eq(s.previews.designId, designId)))
    .run();
  const ids = ctx.db
    .select({ id: s.options.id })
    .from(s.options)
    .where(and(eq(s.options.eventId, eventId), eq(s.options.designId, designId)))
    .all()
    .map((o) => o.id);
  if (ids.length) {
    const affected = ctx.db
      .select()
      .from(s.reviews)
      .where(eq(s.reviews.eventId, eventId))
      .all()
      .filter((r) => ids.includes(r.optionA) || ids.includes(r.optionB));
    for (const review of affected)
      ctx.db
        .update(s.reviews)
        .set({ status: "stale", staleReason: reason, revision: review.revision + 1 })
        .where(eq(s.reviews.id, review.id))
        .run();
  }
}

export function mutateWorkspace(ctx: DatabaseContext, raw: unknown): { eventId: string | null } {
  const parsed = mutationSchema.safeParse(raw);
  if (!parsed.success)
    throw new WorkspaceError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  const cmd = parsed.data;
  return ctx.sqlite
    .transaction(() => {
      const now = new Date().toISOString();
      if (cmd.op === "createEvent") {
        const id = crypto.randomUUID();
        ctx.db
          .insert(s.events)
          .values({
            ...cmd.input,
            eventDate: cmd.input.eventDate || null,
            id,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        log(ctx, id, cmd.op, id, {}, now);
        return { eventId: id };
      }
      const event = ctx.db.select().from(s.events).where(eq(s.events.id, cmd.eventId)).get();
      if (!event || event.archived) throw new WorkspaceError("This event is unavailable.", 404);
      if (event.revision !== cmd.revision)
        throw new WorkspaceError(
          "This event changed in another tab. Refresh to see the latest version before saving.",
          409,
        );
      const teamInEvent = (id: string) => {
        const row = ctx.db
          .select()
          .from(s.teams)
          .where(and(eq(s.teams.id, id), eq(s.teams.eventId, event.id)))
          .get();
        if (!row) throw new WorkspaceError("Choose a team from this event.");
        return row;
      };
      let entityId = event.id;
      if (cmd.op === "importTeams") {
        for (const input of cmd.input.rows) {
          if (!totalQuantity(input.quantities))
            throw new WorkspaceError(`Team ${input.name}: add at least one shirt.`);
          const existing = ctx.db.select().from(s.teams).where(eq(s.teams.eventId, event.id)).all();
          if (
            existing.some(
              (t) =>
                t.name.toLowerCase() === input.name.toLowerCase() ||
                t.code.toLowerCase() === input.code.toLowerCase(),
            )
          )
            throw new WorkspaceError(
              `Team ${input.name}: duplicate name or short code. No rows were imported.`,
            );
          ctx.db
            .insert(s.teams)
            .values({
              ...input,
              code: input.code.toUpperCase(),
              id: crypto.randomUUID(),
              eventId: event.id,
            })
            .run();
        }
      } else if (cmd.op === "importFixtures") {
        const eventTeams = ctx.db.select().from(s.teams).where(eq(s.teams.eventId, event.id)).all();
        for (const input of cmd.input.rows) {
          const a = eventTeams.find((t) => t.code.toLowerCase() === input.teamA.toLowerCase());
          const b = eventTeams.find((t) => t.code.toLowerCase() === input.teamB.toLowerCase());
          if (!a || !b || a.id === b.id)
            throw new WorkspaceError(
              `Fixture ${input.label}: use two different team codes from this event. No rows were imported.`,
            );
          const pairKey = [a.id, b.id].sort().join("|");
          if (
            ctx.db
              .select()
              .from(s.fixtures)
              .where(and(eq(s.fixtures.eventId, event.id), eq(s.fixtures.pairKey, pairKey)))
              .get()
          )
            throw new WorkspaceError(
              `Fixture ${input.label}: this pair already exists. No rows were imported.`,
            );
          ctx.db
            .insert(s.fixtures)
            .values({
              id: crypto.randomUUID(),
              eventId: event.id,
              teamA: a.id,
              teamB: b.id,
              pairKey,
              label: input.label,
            })
            .run();
        }
      } else if (cmd.op === "updateEvent") {
        if (
          cmd.input.currency !== event.currency &&
          ctx.db.select().from(s.options).where(eq(s.options.eventId, event.id)).get()
        )
          throw new WorkspaceError(
            "Currency cannot change after shirt prices are added. Create a separate event for another currency.",
          );
        ctx.db
          .update(s.events)
          .set({ ...cmd.input, eventDate: cmd.input.eventDate || null })
          .where(eq(s.events.id, event.id))
          .run();
      } else if (cmd.op === "archiveEvent") {
        ctx.db.update(s.events).set({ archived: true }).where(eq(s.events.id, event.id)).run();
      } else if (cmd.op === "addTeam" || cmd.op === "updateTeam") {
        if (!totalQuantity(cmd.input.quantities))
          throw new WorkspaceError("Add at least one shirt to the size quantities.");
        const existing = ctx.db.select().from(s.teams).where(eq(s.teams.eventId, event.id)).all();
        const updating = cmd.op === "updateTeam" ? cmd.teamId : null;
        if (
          existing.some(
            (t) =>
              t.id !== updating &&
              (t.name.toLowerCase() === cmd.input.name.toLowerCase() ||
                t.code.toLowerCase() === cmd.input.code.toLowerCase()),
          )
        )
          throw new WorkspaceError("Team names and short codes must be unique in this event.");
        if (cmd.op === "addTeam") {
          entityId = crypto.randomUUID();
          ctx.db
            .insert(s.teams)
            .values({
              ...cmd.input,
              code: cmd.input.code.toUpperCase(),
              id: entityId,
              eventId: event.id,
            })
            .run();
        } else {
          const prior = teamInEvent(cmd.teamId);
          entityId = prior.id;
          ctx.db
            .update(s.teams)
            .set({ ...cmd.input, code: cmd.input.code.toUpperCase(), revision: prior.revision + 1 })
            .where(eq(s.teams.id, prior.id))
            .run();
        }
      } else if (cmd.op === "addFixture") {
        teamInEvent(cmd.input.teamA);
        teamInEvent(cmd.input.teamB);
        if (cmd.input.teamA === cmd.input.teamB)
          throw new WorkspaceError("A team cannot play itself.");
        const pairKey = [cmd.input.teamA, cmd.input.teamB].sort().join("|");
        if (
          ctx.db
            .select()
            .from(s.fixtures)
            .where(and(eq(s.fixtures.eventId, event.id), eq(s.fixtures.pairKey, pairKey)))
            .get()
        )
          throw new WorkspaceError("This opposing pair is already in the fixture list.");
        entityId = crypto.randomUUID();
        ctx.db
          .insert(s.fixtures)
          .values({ ...cmd.input, id: entityId, eventId: event.id, pairKey })
          .run();
      } else if (cmd.op === "removeFixture") {
        const row = ctx.db
          .select()
          .from(s.fixtures)
          .where(and(eq(s.fixtures.id, cmd.fixtureId), eq(s.fixtures.eventId, event.id)))
          .get();
        if (!row) throw new WorkspaceError("Fixture not found.", 404);
        if (ctx.db.select().from(s.reviews).where(eq(s.reviews.fixtureId, row.id)).get())
          throw new WorkspaceError(
            "This fixture has review history and cannot be removed in the baseline.",
          );
        entityId = row.id;
        ctx.db.delete(s.fixtures).where(eq(s.fixtures.id, row.id)).run();
      } else if (cmd.op === "addDesign" || cmd.op === "updateDesign") {
        if (cmd.op === "addDesign") {
          entityId = crypto.randomUUID();
          ctx.db
            .insert(s.designs)
            .values({ ...cmd.input, id: entityId, eventId: event.id })
            .run();
        } else {
          const prior = ctx.db
            .select()
            .from(s.designs)
            .where(and(eq(s.designs.id, cmd.designId), eq(s.designs.eventId, event.id)))
            .get();
          if (!prior) throw new WorkspaceError("Shirt design not found.", 404);
          entityId = prior.id;
          ctx.db
            .update(s.designs)
            .set({ ...cmd.input, revision: prior.revision + 1 })
            .where(eq(s.designs.id, prior.id))
            .run();
          invalidate(
            ctx,
            event.id,
            "Shirt appearance changed. Review the new preview before using it.",
            prior.id,
          );
        }
      } else if (cmd.op === "addOption") {
        teamInEvent(cmd.input.teamId);
        if (
          !ctx.db
            .select()
            .from(s.designs)
            .where(and(eq(s.designs.id, cmd.input.designId), eq(s.designs.eventId, event.id)))
            .get()
        )
          throw new WorkspaceError("Choose a shirt from this event.");
        if (cmd.input.owned && (cmd.input.unitMinor || cmd.input.setupMinor))
          throw new WorkspaceError("Owned shirts have no new purchase or setup cost.");
        entityId = crypto.randomUUID();
        ctx.db
          .insert(s.options)
          .values({ ...cmd.input, id: entityId, eventId: event.id })
          .run();
      } else if (cmd.op === "updateOption") {
        const prior = ctx.db
          .select()
          .from(s.options)
          .where(and(eq(s.options.id, cmd.optionId), eq(s.options.eventId, event.id)))
          .get();
        if (!prior) throw new WorkspaceError("Shirt option not found.", 404);
        if (prior.owned && (cmd.input.unitMinor || cmd.input.setupMinor))
          throw new WorkspaceError("Owned shirts have no new purchase or setup cost.");
        entityId = prior.id;
        ctx.db
          .update(s.options)
          .set({ ...cmd.input, revision: prior.revision + 1 })
          .where(eq(s.options.id, prior.id))
          .run();
      }
      invalidate(ctx, event.id, "Event inputs changed");
      ctx.db
        .update(s.events)
        .set({ revision: event.revision + 1, updatedAt: now })
        .where(eq(s.events.id, event.id))
        .run();
      log(
        ctx,
        event.id,
        cmd.op,
        entityId,
        { previousRevision: event.revision, revision: event.revision + 1 },
        now,
      );
      return { eventId: cmd.op === "archiveEvent" ? null : event.id };
    })
    .immediate();
}
function log(
  ctx: DatabaseContext,
  eventId: string,
  action: string,
  entityId: string,
  detail: Record<string, unknown>,
  createdAt: string,
) {
  ctx.db
    .insert(s.activity)
    .values({ id: crypto.randomUUID(), eventId, action, entityId, detail, createdAt })
    .run();
}

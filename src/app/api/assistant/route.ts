import { z } from "zod";
import { getDatabase } from "@/server/db";
import { createDraft, applyDraft, explainPlan } from "@/server/assistant";
import { getWorkspace, WorkspaceError } from "@/server/workspace";
import { apiError, assertLocalWrite, readLimited } from "@/server/http";
export const runtime = "nodejs";
const schema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("explain"),
    eventId: z.string(),
    revision: z.number().int(),
    text: z.string().trim().min(1).max(4000),
    consent: z.literal(true),
  }),
  z.object({
    op: z.literal("draft"),
    eventId: z.string(),
    revision: z.number().int(),
    text: z.string().trim().min(1).max(4000),
    consent: z.literal(true),
  }),
  z.object({
    op: z.literal("apply"),
    eventId: z.string(),
    revision: z.number().int(),
    draftId: z.string(),
    confirmed: z.literal(true),
  }),
]);
export async function POST(request: Request) {
  try {
    assertLocalWrite(request);
    const parsed = schema.safeParse(JSON.parse((await readLimited(request, 16000)).toString()));
    if (!parsed.success) throw new WorkspaceError("Check the helper instruction and confirmation.");
    const c = parsed.data,
      ctx = getDatabase();
    if (c.op === "explain")
      return Response.json(await explainPlan(ctx, c.eventId, c.revision, c.text), {
        headers: { "Cache-Control": "no-store" },
      });
    if (c.op === "draft")
      return Response.json(await createDraft(ctx, c.eventId, c.revision, c.text), {
        headers: { "Cache-Control": "no-store" },
      });
    applyDraft(ctx, c.eventId, c.revision, c.draftId);
    return Response.json(getWorkspace(ctx, c.eventId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

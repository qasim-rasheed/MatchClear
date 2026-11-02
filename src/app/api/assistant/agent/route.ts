import { z } from "zod";
import { getDatabase } from "@/server/db";
import { apiError, assertLocalWrite, readLimited } from "@/server/http";
import { WorkspaceError } from "@/server/workspace";
import { prepareOrganizerReply, executeOrganizerProposal } from "@/server/organizer-agent";
import { organizerSections } from "@/domain/assistant-agent";
export const runtime = "nodejs";
const base = { eventId: z.string().min(1).max(100), revision: z.number().int().positive() };
const command = z.discriminatedUnion("op", [
  z.object({
    ...base,
    op: z.literal("prepare"),
    text: z.string().max(4000).optional(),
    suggestionId: z.string().max(250).optional(),
    section: z.enum(organizerSections).optional(),
    consent: z.boolean().optional(),
  }),
  z.object({
    ...base,
    op: z.literal("apply"),
    draftId: z.string().min(1).max(100),
    confirmed: z.literal(true),
  }),
]);
export async function POST(request: Request) {
  try {
    assertLocalWrite(request);
    const parsed = command.safeParse(JSON.parse((await readLimited(request, 32000)).toString()));
    if (!parsed.success) throw new WorkspaceError("Check the assistant request and confirmation.");
    const c = parsed.data,
      ctx = getDatabase();
    const result =
      c.op === "apply"
        ? executeOrganizerProposal(ctx, c.eventId, c.revision, c.draftId)
        : await prepareOrganizerReply(ctx, c.eventId, c.revision, c);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

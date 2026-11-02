import { getDatabase } from "@/server/db";
import { orderCommand } from "@/server/orders";
import { getWorkspace } from "@/server/workspace";
import { apiError, assertLocalWrite, readLimited } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalWrite(request);
    const ctx = getDatabase();
    const result = orderCommand(ctx, JSON.parse((await readLimited(request, 32768)).toString()));
    return Response.json(getWorkspace(ctx, result.eventId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

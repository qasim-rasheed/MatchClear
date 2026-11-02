import { getDatabase } from "@/server/db";
import { assertLocalWrite, apiError, readLimited } from "@/server/http";
import { storePhoto } from "@/server/pipeline";
import { getWorkspace, WorkspaceError } from "@/server/workspace";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalWrite(request);
    const type = request.headers.get("content-type") || "";
    if (!type.startsWith("multipart/form-data"))
      throw new WorkspaceError("Choose a photo with the upload form.");
    const body = await readLimited(request, 10_100_000);
    const form = await new Response(body, { headers: { "Content-Type": type } }).formData();
    const ctx = getDatabase();
    const result = await storePhoto(ctx, form);
    return Response.json(getWorkspace(ctx, result.eventId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}

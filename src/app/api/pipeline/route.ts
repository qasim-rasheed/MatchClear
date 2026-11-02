import { retryLocalDeletions } from "@/server/privacy";
import { getDatabase } from "@/server/db";
import { assertLocalWrite, apiError, readLimited } from "@/server/http";
import { applyPipeline } from "@/server/pipeline";
import { getWorkspace, WorkspaceError } from "@/server/workspace";
import { PrivateFiles } from "@/server/storage/private-files";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalWrite(request);
    let command: unknown;
    try {
      command = JSON.parse((await readLimited(request, 32_768)).toString());
    } catch (e) {
      if (e instanceof WorkspaceError) throw e;
      throw new WorkspaceError("Send valid JSON.");
    }
    const ctx = getDatabase();
    const result = applyPipeline(ctx, command);
    const files = new PrivateFiles();
    await retryLocalDeletions(ctx, files);
    return Response.json(getWorkspace(ctx, result.eventId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}

import { getDatabase } from "@/server/db";
import { seedDatabase } from "@/server/db/seed";
import { getWorkspace, mutateWorkspace, WorkspaceError } from "@/server/workspace";
import { assertLocalRead, readLimited } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  if (error instanceof WorkspaceError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "Workspace operation failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return Response.json(
    { error: "The change could not be saved. Your previous data is unchanged." },
    { status: 500 },
  );
}
export async function GET(request: Request) {
  try {
    assertLocalRead(request);
    const ctx = getDatabase();
    seedDatabase(ctx);
    return Response.json(getWorkspace(ctx, new URL(request.url).searchParams.get("event")), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const localHost = host && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  if (!origin || !localHost || origin !== `http://${host}`)
    return Response.json(
      { error: "Changes must come from this local workspace." },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Send JSON data." }, { status: 415 });
  let body: unknown;
  try {
    body = JSON.parse((await readLimited(request, 32_768)).toString("utf8"));
  } catch (error) {
    if (error instanceof WorkspaceError) return failure(error);
    return Response.json({ error: "The request is not valid JSON." }, { status: 400 });
  }
  try {
    const ctx = getDatabase();
    const result = mutateWorkspace(ctx, body);
    return Response.json(getWorkspace(ctx, result.eventId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

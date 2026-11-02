import { WorkspaceError } from "./workspace";
export function assertLocalWrite(request: Request) {
  const host = request.headers.get("host");
  if (
    !host ||
    !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ||
    request.headers.get("origin") !== `http://${host}`
  )
    throw new WorkspaceError("Changes must come from this local workspace.", 403);
}
export function assertLocalRead(request: Request) {
  if (
    !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.get("host") || "") ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new WorkspaceError("Open this file from the local workspace.", 403);
}
export function apiError(error: unknown) {
  if (error instanceof SyntaxError)
    return Response.json({ error: "Send valid JSON." }, { status: 400 });
  if (error instanceof WorkspaceError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error("Local operation failed", error instanceof Error ? error.name : "Unknown");
  return Response.json(
    { error: "The operation could not finish. Refresh saved data before trying again." },
    { status: 500 },
  );
}
export async function readLimited(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new WorkspaceError("This upload is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceError("A request body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new WorkspaceError("This upload is too large.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

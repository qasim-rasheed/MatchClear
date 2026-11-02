import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/server/db";
import { assets, events } from "@/server/db/schema";
import { PrivateFiles } from "@/server/storage/private-files";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const host = request.headers.get("host") || "";
  if (
    !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return new Response(null, { status: 403 });
  const url = new URL(request.url);
  const ctx = getDatabase();
  const row = ctx.db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.id, url.searchParams.get("id") || ""),
        eq(assets.eventId, url.searchParams.get("event") || ""),
      ),
    )
    .get();
  if (
    !row ||
    row.deletedAt ||
    ctx.db.select().from(events).where(eq(events.id, row.eventId)).get()?.archived
  )
    return new Response(null, { status: 404 });
  try {
    const data = await new PrivateFiles().read(row.relativePath);
    return new Response(data, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

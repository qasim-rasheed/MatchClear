import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDatabase } from "@/server/db";
import { assets } from "@/server/db/schema";
import { getBrief } from "@/server/orders";
import { briefCsv, briefHtml } from "@/server/brief-format";
import { apiError, assertLocalRead } from "@/server/http";
import { PrivateFiles } from "@/server/storage/private-files";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    assertLocalRead(request);
    const url = new URL(request.url);
    const eventId = url.searchParams.get("event") || "";
    const ctx = getDatabase();
    const { snapshot, outdated } = getBrief(ctx, eventId, url.searchParams.get("id") || "");
    const format = url.searchParams.get("format") || "html";
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (format === "json")
      return new Response(JSON.stringify({ ...snapshot, outdated }, null, 2), {
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Disposition": 'attachment; filename="matchclear-order-brief.json"',
        },
      });
    if (format === "csv")
      return new Response(briefCsv(snapshot), {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="matchclear-order-brief.csv"',
        },
      });
    const images: Record<string, string> = {};
    const files = new PrivateFiles();
    await Promise.all(
      snapshot.lines
        .flatMap((l) => [
          l.referenceAssetId,
          ...(snapshot.includePlayerPhotos && l.previewAssetId ? [l.previewAssetId] : []),
        ])
        .map(async (id) => {
          const asset = ctx.db
            .select()
            .from(assets)
            .where(and(eq(assets.id, id), eq(assets.eventId, eventId)))
            .get();
          if (asset && !asset.deletedAt) {
            try {
              images[id] =
                `data:image/jpeg;base64,${(await files.read(asset.relativePath)).toString("base64")}`;
            } catch {
              /* Missing/deleted files stay unavailable. */
            }
          }
        }),
    );
    const nonce = randomBytes(16).toString("base64");
    return new Response(briefHtml(snapshot, images, outdated, nonce), {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

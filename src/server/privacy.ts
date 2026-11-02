import { unlink } from "node:fs/promises";
import { eq, like } from "drizzle-orm";
import type { DatabaseContext } from "./db";
import { runtimeSettings } from "./db/schema";
import { PrivateFiles } from "./storage/private-files";

export async function retryLocalDeletions(ctx: DatabaseContext, files = new PrivateFiles()) {
  const rows = ctx.db
    .select()
    .from(runtimeSettings)
    .where(like(runtimeSettings.key, "cleanup:%"))
    .all();
  let removed = 0;
  for (const row of rows) {
    try {
      await unlink(files.path(row.value)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      ctx.db.delete(runtimeSettings).where(eq(runtimeSettings.key, row.key)).run();
      removed++;
    } catch {
      /* Tombstones already prevent access; keep the durable cleanup entry to retry. */
    }
  }
  return { removed, pending: rows.length - removed };
}

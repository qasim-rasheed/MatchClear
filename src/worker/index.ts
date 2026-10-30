import { openDatabase } from "../server/db";
import { eq, and } from "drizzle-orm";
import { jobs } from "../server/db/schema";

const ctx = openDatabase();
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function tick() {
  // Baseline worker deliberately runs only local health checks. Provider rendering is still CLI-only.
  const claimed = ctx.sqlite
    .transaction(() => {
      const job = ctx.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, "queued"), eq(jobs.kind, "healthcheck")))
        .get();
      if (!job) return null;
      ctx.db
        .update(jobs)
        .set({
          status: "running",
          leaseUntil: new Date(Date.now() + 30_000).toISOString(),
          attempts: job.attempts + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(jobs.id, job.id))
        .run();
      return job;
    })
    .immediate();
  if (claimed)
    ctx.db
      .update(jobs)
      .set({ status: "success", leaseUntil: null, updatedAt: new Date().toISOString() })
      .where(eq(jobs.id, claimed.id))
      .run();
}
console.log(
  "MatchClear local worker started. Baseline handles healthcheck jobs; no automatic provider submissions.",
);
async function main() {
  try {
    do {
      await tick();
      if (process.argv.includes("--once")) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (!stopping);
  } finally {
    ctx.sqlite.close();
  }
}
main().catch(() => {
  console.error("The local worker stopped after a database error.");
  process.exitCode = 1;
});

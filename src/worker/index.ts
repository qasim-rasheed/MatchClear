import { openDatabase } from "../server/db";
import { workerTick } from "./process";

const ctx = openDatabase();
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
const plansOnly = process.argv.includes("--plans-only");
console.log(
  plansOnly
    ? "MatchClear planning-only worker started. Preview jobs will not run."
    : "MatchClear worker started: previews, saved provider task polling and tournament planning.",
);
async function main() {
  try {
    do {
      await workerTick(ctx, plansOnly ? { onlyKinds: ["plan", "healthcheck"] } : {});
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

import { resolve } from "node:path";
import { openDatabase } from "../src/server/db";
import { createBackup, restoreBackup } from "../src/server/backup";
async function main() {
  const args = process.argv.slice(2),
    value = (flag: string) => args[args.indexOf(flag) + 1];
  if (args[0] === "restore") {
    if (!args.includes("--from") || !args.includes("--to") || !value("--from") || !value("--to"))
      throw new Error("Use data:restore -- --from BACKUP_FOLDER --to NEW_LOCAL_FOLDER");
    console.log(await restoreBackup(value("--from"), value("--to")));
    return;
  }
  const destination = args.includes("--to")
    ? value("--to")
    : resolve(".local/backups", new Date().toISOString().replace(/[:.]/g, "-"));
  const ctx = openDatabase();
  try {
    console.log(await createBackup(ctx, destination));
  } finally {
    ctx.sqlite.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Backup operation failed.");
  process.exitCode = 1;
});

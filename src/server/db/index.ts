import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import * as schema from "./schema";

export function openDatabase(
  filename = resolve(process.env.MATCHCLEAR_DATA_DIR || ".local", "matchclear.sqlite"),
) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)",
  );
  const apply = sqlite.transaction(() => {
    for (const name of readdirSync(resolve("migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(resolve("migrations", name), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      const prior = sqlite
        .prepare("SELECT hash FROM schema_migrations WHERE name = ?")
        .get(name) as { hash: string } | undefined;
      if (prior && prior.hash !== hash) throw new Error(`Applied migration changed: ${name}`);
      if (!prior) {
        sqlite.exec(sql);
        sqlite.prepare("INSERT INTO schema_migrations (name, hash) VALUES (?, ?)").run(name, hash);
      }
    }
  });
  apply();
  return { db: drizzle(sqlite, { schema }), sqlite };
}
export type DatabaseContext = ReturnType<typeof openDatabase>;
const globalDb = globalThis as typeof globalThis & { matchclearDb?: DatabaseContext };
export function getDatabase() {
  return (globalDb.matchclearDb ??= openDatabase());
}

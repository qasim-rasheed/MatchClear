import Database from "better-sqlite3";
import { mkdir, readFile, writeFile, copyFile, realpath, stat } from "node:fs/promises";
import { resolve, sep, join } from "node:path";
import { createHash } from "node:crypto";
import { openDatabase, type DatabaseContext } from "./db";
import { PrivateFiles } from "./storage/private-files";

type Manifest = {
  version: 1;
  createdAt: string;
  database: { file: string; sha256: string };
  files: { key: string; sha256: string }[];
};
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const safeKey = (key: string) => /^[A-Za-z0-9-]+\.(jpg|png|json)$/.test(key);
async function freshLocalDirectory(path: string) {
  const local = resolve(".local"),
    target = resolve(path);
  if (!target.startsWith(local + sep))
    throw new Error("Use a new directory inside this repository's .local folder.");
  // Refuse links/junctions escaping .local even when the string prefix looks safe.
  await mkdir(local, { recursive: true });
  const parent = resolve(target, "..");
  const realLocal = await realpath(local);
  let ancestor = parent;
  for (;;) {
    try {
      const existing = await realpath(ancestor);
      if (existing !== realLocal && !existing.startsWith(realLocal + sep))
        throw new Error("Backup destination escapes the local data folder.");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = resolve(ancestor, "..");
    }
  }
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  if (realParent !== realLocal && !realParent.startsWith(realLocal + sep))
    throw new Error("Backup destination escapes the local data folder.");
  await mkdir(target); // EEXIST intentionally prevents replacement of any existing directory.
  return target;
}
function canonicalSchema(db: Database.Database) {
  return JSON.stringify(
    db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all(),
  );
}
function verifyDatabase(db: Database.Database) {
  const template = openDatabase(":memory:");
  try {
    if (canonicalSchema(db) !== canonicalSchema(template.sqlite))
      throw new Error("Backup schema does not match this MatchClear version.");
    if (
      db.pragma("quick_check", { simple: true }) !== "ok" ||
      (db.pragma("foreign_key_check") as unknown[]).length
    )
      throw new Error("Backup database integrity check failed.");
    const expected = template.sqlite
      .prepare("SELECT name,hash FROM schema_migrations ORDER BY name")
      .all();
    if (
      JSON.stringify(db.prepare("SELECT name,hash FROM schema_migrations ORDER BY name").all()) !==
      JSON.stringify(expected)
    )
      throw new Error("Backup migration checksums do not match.");
  } finally {
    template.sqlite.close();
  }
}
export async function createBackup(
  ctx: DatabaseContext,
  destination: string,
  files = new PrivateFiles(),
) {
  const target = await freshLocalDirectory(destination);
  const dbPath = join(target, "matchclear.sqlite");
  await ctx.sqlite.backup(dbPath);
  const frozen = new Database(dbPath, { readonly: true });
  let rows: { relative_path: string; sha256: string }[];
  try {
    verifyDatabase(frozen);
    rows = frozen
      .prepare("SELECT relative_path,sha256 FROM assets WHERE deleted_at IS NULL")
      .all() as typeof rows;
  } finally {
    frozen.close();
  }
  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    database: { file: "matchclear.sqlite", sha256: hash(await readFile(dbPath)) },
    files: [],
  };
  await mkdir(join(target, "files"));
  for (const row of rows) {
    if (!safeKey(row.relative_path)) throw new Error("A private file key is unsupported.");
    const bytes = await files.read(row.relative_path);
    if (hash(bytes) !== row.sha256)
      throw new Error("A source file changed; backup stopped. Retry after stopping the worker.");
    if (!manifest.files.some((f) => f.key === row.relative_path)) {
      await writeFile(join(target, "files", row.relative_path), bytes, { flag: "wx" });
      manifest.files.push({ key: row.relative_path, sha256: row.sha256 });
    }
  }
  await writeFile(join(target, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  return { directory: target, files: manifest.files.length };
}
export async function restoreBackup(source: string, destination: string) {
  const root = resolve(source),
    manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Manifest;
  if (
    manifest.version !== 1 ||
    manifest.database?.file !== "matchclear.sqlite" ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 10000
  )
    throw new Error("Unsupported backup manifest.");
  const dbPath = join(root, "matchclear.sqlite");
  if (
    (await stat(dbPath)).size > 512_000_000 ||
    hash(await readFile(dbPath)) !== manifest.database.sha256
  )
    throw new Error("Backup database checksum failed.");
  const original = new Database(dbPath, { readonly: true });
  let required: { relative_path: string; sha256: string }[];
  try {
    verifyDatabase(original);
    required = original
      .prepare("SELECT relative_path,sha256 FROM assets WHERE deleted_at IS NULL")
      .all() as typeof required;
  } finally {
    original.close();
  }
  if (
    required.some(
      (r) => !manifest.files.some((f) => f.key === r.relative_path && f.sha256 === r.sha256),
    )
  )
    throw new Error("Backup is missing a referenced photo.");
  for (const file of manifest.files) {
    if (!safeKey(file.key)) throw new Error("Invalid backup file key.");
    const filePath = await realpath(join(root, "files", file.key)),
      fileRoot = await realpath(join(root, "files"));
    if (!filePath.startsWith(fileRoot + sep) || hash(await readFile(filePath)) !== file.sha256)
      throw new Error("Backup photo checksum or path check failed.");
  }
  const target = await freshLocalDirectory(destination);
  await copyFile(dbPath, join(target, "matchclear.sqlite"));
  await mkdir(join(target, "files"));
  for (const file of manifest.files)
    await copyFile(join(root, "files", file.key), join(target, "files", file.key));
  const db = new Database(join(target, "matchclear.sqlite"));
  try {
    db.prepare(
      "UPDATE jobs SET status='needs-attention',error_code='RESTORED_HOLD',lease_owner=NULL,lease_until=NULL WHERE status IN ('queued','uploading','submitting','running')",
    ).run();
    db.prepare(
      "DELETE FROM runtime_settings WHERE key IN ('workerHeartbeat','workerMode') OR key LIKE 'cleanup:%'",
    ).run();
    db.prepare("UPDATE assistant_drafts SET applied_at=? WHERE applied_at IS NULL").run(
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
  return { directory: target, files: manifest.files.length };
}

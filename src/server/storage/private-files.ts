import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

export class PrivateFiles {
  readonly root: string;
  constructor(root = resolve(process.env.MATCHCLEAR_DATA_DIR || ".local", "files")) {
    this.root = resolve(root);
  }
  path(key: string) {
    const path = resolve(this.root, key);
    const rel = relative(this.root, path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw new Error("Invalid private file key.");
    return path;
  }
  async put(data: Uint8Array, extension: "jpg" | "png" | "json") {
    await mkdir(this.root, { recursive: true });
    const key = `${randomUUID()}.${extension}`;
    await writeFile(this.path(key), data, { flag: "wx" });
    return key;
  }
  read(key: string) {
    return readFile(this.path(key));
  }
}

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { applyPipeline } from "../src/server/pipeline";
import { workerTick } from "../src/worker/process";

// Explicit opt-in, restricted to the precise stock-photo example. Never run other queued jobs.
async function main() {
  if (!process.argv.includes("--confirm-stock-4-units"))
    throw new Error("Explicit stock-photo approval flag is required.");
  const ctx = openDatabase();
  const eventId = "stock-preview-example";
  try {
    const normalizeHash = async (file: string) =>
      createHash("sha256")
        .update(
          await sharp(await readFile(file), { limitInputPixels: 40_000_000 })
            .rotate()
            .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
            .toColourspace("srgb")
            .jpeg({ quality: 93 })
            .toBuffer(),
        )
        .digest("hex");
    const personHash = await normalizeHash(".local/samples/person-monstera-6311639.jpg");
    const hashes = [
      await normalizeHash(".local/samples/shirt-steinke-20669538.jpg"),
      await normalizeHash(".local/samples/shirt-steinke-36392069.jpg"),
    ];
    for (let i = 0; i < 2; i++) {
      const team = ctx.db
        .select()
        .from(s.teams)
        .where(eq(s.teams.id, `stock-team-${i}`))
        .get();
      const design = ctx.db
        .select()
        .from(s.designs)
        .where(eq(s.designs.id, `stock-design-${i}`))
        .get();
      const person = team?.personAssetId
        ? ctx.db.select().from(s.assets).where(eq(s.assets.id, team.personAssetId)).get()
        : null;
      const ref = design?.assetId
        ? ctx.db.select().from(s.assets).where(eq(s.assets.id, design.assetId)).get()
        : null;
      if (
        !person ||
        !ref ||
        person.eventId !== eventId ||
        ref.eventId !== eventId ||
        person.deletedAt ||
        ref.deletedAt ||
        person.sha256 !== personHash ||
        ref.sha256 !== hashes[i]
      )
        throw new Error(
          "Example sources differ from the specifically approved stock photos. Test stopped.",
        );
    }
    const event = ctx.db.select().from(s.events).where(eq(s.events.id, eventId)).get()!;
    const before = ctx.db
      .select()
      .from(s.usage)
      .all()
      .reduce((sum, row) => sum + row.estimatedUnits, 0);
    applyPipeline(ctx, {
      op: "queuePreviews",
      eventId,
      revision: event.revision,
      consentConfirmed: true,
      retryFailed: false,
      items: [0, 1].map((i) => ({ teamId: `stock-team-${i}`, designId: `stock-design-${i}` })),
    });
    const after = ctx.db
      .select()
      .from(s.usage)
      .all()
      .reduce((sum, row) => sum + row.estimatedUnits, 0);
    if (after - before > 4) throw new Error("Unexpected unit reservation; no worker started.");
    const ids = ctx.db
      .select()
      .from(s.jobs)
      .all()
      .filter((j) => j.kind === "render" && (j.payload as { eventId?: string }).eventId === eventId)
      .map((j) => j.id);
    if (ids.length > 2)
      throw new Error("More than two example jobs exist; inspect them before running.");
    console.log(
      "Running only the approved white/orange stock-photo jobs. At most 4 newly estimated units.",
    );
    const started = Date.now();
    while (Date.now() - started < 300_000) {
      await workerTick(ctx, { onlyJobIds: ids });
      const jobs = ctx.db
        .select()
        .from(s.jobs)
        .all()
        .filter((j) => ids.includes(j.id));
      if (
        jobs.every((j) => ["success", "failed", "needs-attention", "cancelled"].includes(j.status))
      ) {
        console.log(
          JSON.stringify(
            jobs.map((j) => ({
              id: j.id,
              status: j.status,
              errorCode: j.errorCode,
              estimatedUnits: j.estimatedUnits,
            })),
            null,
            2,
          ),
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    console.log(
      "Stopped at the bounded test time. Known task IDs remain saved; no additional render is submitted.",
    );
  } finally {
    ctx.sqlite.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Restricted stock test failed.");
  process.exitCode = 1;
});

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { openDatabase } from "../src/server/db";
import { jobs, usage } from "../src/server/db/schema";
import { ProviderError, YouCamClient } from "../src/server/youcam/client";

async function main() {
  const sample = process.argv.includes("--sample");
  const dryRun = process.argv.includes("--dry-run");
  const person = sample
    ? ".local/samples/person-monstera-6311639.jpg"
    : process.env.MATCHCLEAR_PERSON_PHOTO;
  const garment = sample
    ? ".local/samples/shirt-steinke-20669538.jpg"
    : process.env.MATCHCLEAR_GARMENT_PHOTO;
  if (!sample && process.env.MATCHCLEAR_PHOTO_PERMISSION_CONFIRMED !== "true")
    throw new Error(
      "Confirm photo permissions in .env.local before a live test, or use the documented licensed --sample inputs.",
    );
  if (!person || !garment) throw new Error("Set permitted person and garment file paths first.");
  const normalize = async (path: string) => {
    const input = await readFile(resolve(path));
    if (input.byteLength > 10_000_000) throw new Error("Input image exceeds 10 MB.");
    const metadata = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
    if (
      !["jpeg", "png"].includes(metadata.format || "") ||
      Math.min(metadata.width || 0, metadata.height || 0) < 384
    )
      throw new Error("Use a JPEG or PNG with both sides at least 384 pixels.");
    return sharp(input)
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .jpeg({ quality: 93 })
      .toBuffer();
  };
  const [src, ref] = await Promise.all([normalize(person), normalize(garment)]);
  const hash = createHash("sha256")
    .update(src)
    .update(ref)
    .update("cloth-v3:upper_body")
    .digest("hex");
  const dir = resolve(process.env.MATCHCLEAR_DATA_DIR || ".local", "feasibility");
  await mkdir(dir, { recursive: true });
  const reportPath = resolve(dir, `${hash}.json`);
  if (dryRun) {
    console.log(
      "Input preparation passed. No provider calls made. API key configured:",
      Boolean(process.env.YOUCAM_API_KEY?.trim()),
    );
    return;
  }
  const client = new YouCamClient(process.env.YOUCAM_API_KEY || "");
  const ctx = openDatabase();
  const started = Date.now();
  let job = ctx.db
    .select()
    .from(jobs)
    .where(eq(jobs.id, `spike-${hash}`))
    .get();
  try {
    if (job?.status === "success") {
      console.log("This input already has a saved result. No new render submitted.");
      return;
    }
    if (job && !job.providerTaskId)
      throw new Error(
        "An earlier attempt has no confirmed provider task ID. Inspect its status before submitting again; automatic resubmission is disabled.",
      );
    if (!job) {
      ctx.sqlite
        .transaction(() => {
          const spent = ctx.db
            .select({ units: sql<number>`coalesce(sum(${usage.estimatedUnits}), 0)` })
            .from(usage)
            .get()!.units;
          const limit = Number(process.env.MATCHCLEAR_API_UNIT_LIMIT || 40);
          if (!Number.isFinite(limit) || spent + 2 > limit)
            throw new Error("The configured feasibility unit allowance has been reached.");
          const now = new Date().toISOString();
          ctx.db
            .insert(jobs)
            .values({
              id: `spike-${hash}`,
              kind: "manual-feasibility",
              status: "submitting",
              payload: {
                inputHash: hash,
                sample,
                apiVersion: "v3",
                permissionBasis: sample
                  ? "Pexels license; see asset register"
                  : "User confirmed permission",
              },
              estimatedUnits: 2,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          ctx.db
            .insert(usage)
            .values({
              id: crypto.randomUUID(),
              jobId: `spike-${hash}`,
              estimatedUnits: 2,
              confirmedUnits: null,
              createdAt: now,
            })
            .run();
        })
        .immediate();
      const sourceId = await client.upload(src, "person.jpg");
      const referenceId = await client.upload(ref, "shirt.jpg");
      const taskId = await client.submit(sourceId, referenceId);
      ctx.db
        .update(jobs)
        .set({ status: "running", providerTaskId: taskId, updatedAt: new Date().toISOString() })
        .where(eq(jobs.id, `spike-${hash}`))
        .run();
      job = ctx.db
        .select()
        .from(jobs)
        .where(eq(jobs.id, `spike-${hash}`))
        .get()!;
      console.log("Task accepted. Estimated render consumption: 2 units. Polling the saved task.");
    }
    for (let attempt = 0; attempt < 36; attempt++) {
      const result = await client.status(job!.providerTaskId!);
      if (result.status === "error") throw new ProviderError(result.error!);
      if (result.status === "success" && result.url) {
        const image = await client.download(result.url);
        await sharp(image)
          .jpeg({ quality: 95 })
          .toFile(resolve(dir, `${hash}.jpg`));
        const report = {
          inputHash: hash,
          apiVersion: "v3",
          garmentCategory: "upper_body",
          status: "success",
          elapsedMs: Date.now() - started,
          estimatedUnits: 2,
          confirmedUnits: null,
          fidelityReview: "pending",
          userStudy: "not conducted",
          sample,
          checkedAt: new Date().toISOString(),
        };
        await writeFile(reportPath, JSON.stringify(report, null, 2));
        ctx.db
          .update(jobs)
          .set({ status: "success", updatedAt: new Date().toISOString() })
          .where(eq(jobs.id, `spike-${hash}`))
          .run();
        console.log(
          JSON.stringify({ ...report, localResult: `.local/feasibility/${hash}.jpg` }, null, 2),
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    console.log(
      "Polling stopped at its limit. The task ID is saved; run the same command to resume without submitting a new task.",
    );
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : "LOCAL_TEST_ERROR";
    ctx.db
      .update(jobs)
      .set({ status: "needs-attention", errorCode: code, updatedAt: new Date().toISOString() })
      .where(eq(jobs.id, `spike-${hash}`))
      .run();
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          status: "needs-attention",
          code,
          estimatedUnits: 2,
          confirmedUnits: null,
          fidelityReview: "not completed",
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    ctx.sqlite.close();
  }
}
main().catch((error) => {
  console.error(
    error instanceof ProviderError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Feasibility test failed.",
  );
  process.exitCode = 1;
});

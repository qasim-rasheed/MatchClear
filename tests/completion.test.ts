import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { prepared, setup } from "./helpers/workflow";
import { orderCommand, getBrief } from "../src/server/orders";
import { briefHtml, briefCsv } from "../src/server/brief-format";
import { workerTick } from "../src/worker/process";
import { createBackup, restoreBackup } from "../src/server/backup";
import {
  applyDraft,
  createDraft,
  validateDraft,
  generateDraft,
  planFacts,
} from "../src/server/assistant";
import * as databaseModule from "../src/server/db";
import { PrivateFiles } from "../src/server/storage/private-files";
import { GET as downloadBrief } from "../src/app/api/brief/route";
import { readPipelineState } from "../src/server/pipeline";
import { retryLocalDeletions } from "../src/server/privacy";
import * as s from "../src/server/db/schema";

async function complete() {
  const env = await prepared();
  env.review();
  env.command("queuePlan", { locks: {}, baseline: { A: "oA", B: "oB" } });
  await workerTick(env.ctx, { onlyKinds: ["plan"], files: env.files });
  const plan = env.ctx.db.select().from(s.plans).get()!;
  const order = (op: string, values: Record<string, unknown>) =>
    orderCommand(env.ctx, { op, eventId: "flow", revision: env.revision(), ...values });
  return { ...env, plan, order };
}
describe("confirmed order briefs", () => {
  it("serves frozen downloads and never resurrects a deleted image", async () => {
    const env = await complete();
    const c = env.order("confirmPlan", { planId: env.plan.id, reviewer: "Organizer" });
    const b = env.order("createBrief", { confirmationId: c.id });
    const read = env.files.read.bind(env.files);
    const dbSpy = vi.spyOn(databaseModule, "getDatabase").mockReturnValue(env.ctx);
    const fileSpy = vi.spyOn(PrivateFiles.prototype, "read").mockImplementation(read);
    const request = (format: string, event = "flow") =>
      new Request(`http://127.0.0.1/api/brief?event=${event}&id=${b.id}&format=${format}`, {
        headers: { host: "127.0.0.1", "sec-fetch-site": "same-origin" },
      });
    try {
      let response = await downloadBrief(request("html"));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(((await response.text()).match(/<img /g) || []).length).toBe(2);
      env.command("deleteAsset", { assetId: env.a.referenceAssetId });
      response = await downloadBrief(request("html"));
      const html = await response.text();
      expect(html).toContain("unavailable or locally deleted");
      expect((html.match(/<img /g) || []).length).toBe(1);
      const json = await (await downloadBrief(request("json"))).json();
      expect(json.includePlayerPhotos).toBe(false);
      expect(json.lines.every((l: { previewAssetId?: string }) => !l.previewAssetId)).toBe(true);
      const csv = await (await downloadBrief(request("csv"))).text();
      expect(csv.split("\r\n")).toHaveLength(3);
      expect((await downloadBrief(request("html", "different"))).status).toBe(404);
    } finally {
      dbSpy.mockRestore();
      fileSpy.mockRestore();
    }
  });
  it("freezes confirmed values and excludes player previews by default", async () => {
    const env = await complete();
    const revision = env.revision();
    const confirmation = env.order("confirmPlan", {
      planId: env.plan.id,
      reviewer: "Organizer test",
    });
    expect(env.revision()).toBe(revision);
    expect(env.ctx.db.select().from(s.plans).get()!.stale).toBe(false);
    const exported = env.order("createBrief", { confirmationId: confirmation.id });
    const brief = getBrief(env.ctx, "flow", exported.id).snapshot;
    expect(brief.includePlayerPhotos).toBe(false);
    expect(brief.lines.every((l) => !l.previewAssetId)).toBe(true);
    expect(brief.fixtures[0].reviewer).toBe("Test reviewer");
    env.ctx.db.update(s.teams).set({ name: "Changed later" }).where(eq(s.teams.id, "A")).run();
    expect(
      getBrief(env.ctx, "flow", exported.id).snapshot.lines.find((l) => l.teamId === "A")!.team,
    ).toBe("Team A");
    expect(() => getBrief(env.ctx, "other-event", exported.id)).toThrow("unavailable");
  });
  it("refuses stale confirmations and old approvals after a rejection", async () => {
    const env = await complete();
    env.review("rejected");
    expect(() =>
      env.order("confirmPlan", { planId: env.plan.id, reviewer: "Organizer test" }),
    ).toThrow("current");
    expect(env.ctx.db.select().from(s.confirmations).all()).toHaveLength(0);
  });
  it("keeps saved briefs historical when inputs change and blocks new exports", async () => {
    const env = await complete();
    const c = env.order("confirmPlan", { planId: env.plan.id, reviewer: "Organizer" });
    const b = env.order("createBrief", { confirmationId: c.id, includePlayerPhotos: true });
    expect(getBrief(env.ctx, "flow", b.id).snapshot.lines.every((l) => l.previewAssetId)).toBe(
      true,
    );
    await env.upload("reference", "dA");
    expect(getBrief(env.ctx, "flow", b.id).outdated).toBe(true);
    expect(() => env.order("createBrief", { confirmationId: c.id })).toThrow("outdated");
  });
  it("escapes printable content and neutralizes spreadsheet formulas", async () => {
    const env = await complete();
    const c = env.order("confirmPlan", { planId: env.plan.id, reviewer: "Organizer" });
    const b = env.order("createBrief", { confirmationId: c.id });
    const brief = getBrief(env.ctx, "flow", b.id).snapshot;
    brief.lines[0].team = '=HYPERLINK("https://example.com")';
    brief.fixtures[0].reason = '<script>alert("x")</script>';
    expect(briefCsv(brief)).toContain("'=HYPERLINK");
    const html = briefHtml(brief, {}, false, "nonce");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("x")');
    expect(html).toContain("Player photos and generated person previews excluded");
  });
});
describe("bounded text drafts", () => {
  it("uses the fixed free OpenRouter model and validates a mocked real SDK response", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-test-only");
    const payload = { budgetMinor: 30050, fixtures: [], locks: [], questions: [] };
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "mock",
            created: 1,
            model: "test",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: JSON.stringify(payload) },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(
        await generateDraft("Set budget to EUR 300.50", {
          currency: "EUR",
          teams: [],
          options: [],
        }),
      ).toEqual(payload);
      const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(args[1].body));
      expect(String(args[0])).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(body.model).toBe("nvidia/nemotron-3.5-super-vl:free");
      expect(body.response_format.type).toBe("json_schema");
      expect(body.tools).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("image_url");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("builds plan explanations from recorded values without reviewer notes or photo data", async () => {
    const env = await complete();
    const facts = planFacts(env.ctx, "flow");
    expect(facts.some((f) => f.id === "budget")).toBe(true);
    expect(JSON.stringify(facts)).not.toContain("Synthetic test decision");
    expect(JSON.stringify(facts)).not.toContain("relativePath");
  });
  it("stores proposals without mutation and applies exact changes once", async () => {
    const env = await setup();
    const revision = env.revision();
    const send = vi.fn(async () => ({
      budgetMinor: 25000,
      fixtures: [],
      locks: [{ teamId: "A", optionId: "oA" }],
      questions: [],
    }));
    const draft = await createDraft(env.ctx, "flow", revision, "Budget 250 and lock A", send);
    expect(env.revision()).toBe(revision);
    expect(env.ctx.db.select().from(s.events).get()!.budgetMinor).toBe(10000);
    applyDraft(env.ctx, "flow", revision, draft.id);
    expect(env.ctx.db.select().from(s.events).get()!.budgetMinor).toBe(25000);
    expect(readPipelineState(env.ctx, "flow").plannerLocks).toEqual({ A: "oA" });
    expect(() => applyDraft(env.ctx, "flow", env.revision(), draft.id)).toThrow("outdated");
  });
  it("rejects unknown IDs and blocks all actions when clarification is needed", () => {
    const context = { currency: "EUR", teams: [{ id: "A", name: "A", code: "AA" }], options: [] };
    expect(() =>
      validateDraft(
        {
          budgetMinor: null,
          fixtures: [],
          locks: [{ teamId: "A", optionId: "invented" }],
          questions: [],
        },
        context,
      ),
    ).toThrow("unknown");
    expect(
      validateDraft(
        { budgetMinor: 1000, fixtures: [], locks: [], questions: ["Which currency?"] },
        context,
      ).budgetMinor,
    ).toBeNull();
  });
  it("rejects stale proposals and rolls back a whole batch on duplicate fixtures", async () => {
    const env = await setup();
    const draft = await createDraft(
      env.ctx,
      "flow",
      env.revision(),
      "Set budget and add duplicate fixture",
      async () => ({
        budgetMinor: 22000,
        fixtures: [{ teamA: "A", teamB: "B", label: "Duplicate" }],
        locks: [],
        questions: [],
      }),
    );
    expect(() => applyDraft(env.ctx, "flow", env.revision(), draft.id)).toThrow("already exists");
    expect(env.ctx.db.select().from(s.events).get()!.budgetMinor).toBe(10000);
    env.ctx.db
      .update(s.events)
      .set({ revision: env.revision() + 1 })
      .run();
    expect(() => applyDraft(env.ctx, "flow", env.revision(), draft.id)).toThrow("outdated");
  });
});
describe("private deletion and recoverable backups", () => {
  it("retries file cleanup after a transient failure", async () => {
    const env = await prepared();
    env.command("deleteAsset", { assetId: env.a.personAssetId });
    const originalPath = env.files.path.bind(env.files);
    let failure = true;
    vi.spyOn(env.files, "path").mockImplementation((key) => {
      if (failure) throw new Error("Temporary lock");
      return originalPath(key);
    });
    expect((await retryLocalDeletions(env.ctx, env.files)).pending).toBeGreaterThan(0);
    failure = false;
    expect((await retryLocalDeletions(env.ctx, env.files)).pending).toBe(0);
    expect(readPipelineState(env.ctx, "flow").previews.find((p) => p.id === env.a.id)!.usable).toBe(
      false,
    );
  });
  it("restores a checksummed snapshot to a new directory and holds queued jobs", async () => {
    const env = await setup();
    env.queue();
    const folder = join(env.files.root, "backup"),
      restored = join(env.files.root, "restored");
    await createBackup(env.ctx, folder, env.files);
    await restoreBackup(folder, restored);
    const db = new Database(join(restored, "matchclear.sqlite"));
    try {
      expect(db.prepare("SELECT COUNT(*) n FROM teams").get()).toEqual({ n: 2 });
      expect(db.prepare("SELECT DISTINCT status FROM jobs").all()).toEqual([
        { status: "needs-attention" },
      ]);
    } finally {
      db.close();
    }
    await expect(restoreBackup(folder, restored)).rejects.toThrow();
    const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
    await writeFile(join(folder, "files", manifest.files[0].key), "tampered");
    await expect(restoreBackup(folder, join(env.files.root, "tampered-restore"))).rejects.toThrow(
      "checksum",
    );
  });
});

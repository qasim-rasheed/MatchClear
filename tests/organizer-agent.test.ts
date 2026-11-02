import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { prepared, setup } from "./helpers/workflow";
import {
  prepareOrganizerReply,
  executeOrganizerProposal,
  interpretOrganizer,
  agentContext,
} from "../src/server/organizer-agent";
import { getWorkspace } from "../src/server/workspace";
import { organizerJourney, assistantSuggestions } from "../src/lib/organizer-journey";
import {
  agentOutputSchema,
  type AgentAction,
  type AgentOutput,
} from "../src/domain/assistant-agent";
import { workerTick } from "../src/worker/process";
import { orderCommand } from "../src/server/orders";
import * as s from "../src/server/db/schema";

const output = (actions: AgentAction[]): AgentOutput => ({
  intent: "change",
  actions,
  questions: [],
  destination: null,
  focusTeamId: null,
});
describe("guided organizer assistant", () => {
  it("every visible suggestion resolves locally across workspace screens", async () => {
    const env = await prepared();
    env.review();
    const interpret = vi.fn(async () => {
      throw new Error("A suggested action must not call AI");
    });
    for (const section of [
      "overview",
      "teams",
      "fixtures",
      "shirts",
      "previews",
      "reviews",
      "plan",
      "brief",
      "settings",
    ] as const) {
      const data = getWorkspace(env.ctx, "flow");
      for (const suggestion of assistantSuggestions(data, section)) {
        const reply = await prepareOrganizerReply(
          env.ctx,
          "flow",
          env.revision(),
          { suggestionId: suggestion.id, section },
          interpret,
        );
        expect(reply.message).toBeTruthy();
        expect(Boolean(reply.navigation || reply.proposal)).toBe(true);
      }
    }
    expect(interpret).not.toHaveBeenCalled();
  }, 15000);
  it("the all-pairings suggestion applies once and an obsolete button fails safely", async () => {
    const env = await setup();
    env.ctx.db.delete(s.fixtures).run();
    const reply = await prepareOrganizerReply(env.ctx, "flow", env.revision(), {
      suggestionId: "round-robin",
      section: "fixtures",
    });
    const applied = executeOrganizerProposal(env.ctx, "flow", env.revision(), reply.proposal!.id);
    expect(applied.data.fixtures).toHaveLength(1);
    await expect(
      prepareOrganizerReply(env.ctx, "flow", env.revision(), {
        suggestionId: "round-robin",
        section: "fixtures",
      }),
    ).rejects.toThrow("suggestion changed");
    expect(env.ctx.db.select().from(s.fixtures).all()).toHaveLength(1);
  });
  it("can reconsider fixed choices and explain changed inputs without a model call", async () => {
    const env = await prepared();
    env.review();
    env.command("queuePlan", { locks: { A: "oA" }, baseline: { A: "oA", B: "oB" } });
    await workerTick(env.ctx, { onlyKinds: ["plan"], files: env.files });
    const budget = await prepareOrganizerReply(
      env.ctx,
      "flow",
      env.revision(),
      { text: "Set budget to 1", consent: true },
      async () => output([{ op: "budget", amountMinor: 100 }]),
    );
    executeOrganizerProposal(env.ctx, "flow", env.revision(), budget.proposal!.id);
    const interpret = vi.fn(async () => output([]));
    const explanation = await prepareOrganizerReply(
      env.ctx,
      "flow",
      env.revision(),
      { text: "Explain my plan" },
      interpret,
    );
    expect(explanation.facts!.some((f) => f.includes("Budget changed from"))).toBe(true);
    expect(interpret).not.toHaveBeenCalled();
    // An incomplete result with a fixed shirt offers a bounded, reviewable unlock action.
    env.command("queuePlan", { locks: { A: "oA" }, baseline: { A: "oA", B: "oB" } });
    env.ctx.db.update(s.reviews).set({ status: "inconclusive" }).run();
    await workerTick(env.ctx, { onlyKinds: ["plan"], files: env.files });
    const suggestion = assistantSuggestions(getWorkspace(env.ctx, "flow"), "plan").find(
      (s) => s.kind === "unlock",
    )!;
    expect(suggestion).toBeTruthy();
    const unlock = await prepareOrganizerReply(
      env.ctx,
      "flow",
      env.revision(),
      { suggestionId: suggestion.id, section: "plan" },
      interpret,
    );
    expect(
      executeOrganizerProposal(env.ctx, "flow", env.revision(), unlock.proposal!.id).data.pipeline!
        .plannerLocks,
    ).toEqual({});
  });
  it("provider failures do not save drafts or change event data", async () => {
    const env = await setup(),
      rev = env.revision();
    await expect(
      prepareOrganizerReply(
        env.ctx,
        "flow",
        rev,
        { text: "Change an ambiguous instruction", consent: true },
        async () => {
          throw new Error("quota unavailable");
        },
      ),
    ).rejects.toThrow("reliable response");
    expect(env.revision()).toBe(rev);
    expect(env.ctx.db.select().from(s.assistantDrafts).all()).toHaveLength(0);
  });
  it("changes suggestions as photos, reviews and confirmed plans progress, and prioritizes the current screen", async () => {
    const env = await prepared();
    let data = getWorkspace(env.ctx, "flow");
    const compare = assistantSuggestions(data, "reviews");
    expect(compare[0]).toMatchObject({
      id: "review:AB",
      navigation: { tab: "reviews", fixtureId: "AB" },
    });
    expect(compare.some((s) => s.kind === "plan")).toBe(false);
    env.review();
    data = getWorkspace(env.ctx, "flow");
    expect(assistantSuggestions(data, "plan")[0].kind).toBe("plan");
    const proposal = await prepareOrganizerReply(env.ctx, "flow", env.revision(), {
      suggestionId: "plan",
      section: "plan",
    });
    const applied = executeOrganizerProposal(
      env.ctx,
      "flow",
      env.revision(),
      proposal.proposal!.id,
    );
    expect(assistantSuggestions(applied.data, "plan").some((s) => s.kind === "plan")).toBe(false);
    await workerTick(env.ctx, {
      onlyKinds: ["plan"],
      onlyJobIds: [applied.jobId!],
      files: env.files,
    });
    const plan = env.ctx.db.select().from(s.plans).get()!;
    orderCommand(env.ctx, {
      op: "confirmPlan",
      eventId: "flow",
      revision: env.revision(),
      planId: plan.id,
      reviewer: "Organizer test",
    });
    expect(assistantSuggestions(getWorkspace(env.ctx, "flow"), "brief")[0].kind).toBe("brief");
  });
  it("updates an existing team's exact size list while keeping the normal planning rules", async () => {
    const env = await setup();
    const quantities = { XS: 0, S: 4, M: 6, L: 2, XL: 0, XXL: 0 };
    const proposal = await prepareOrganizerReply(
      env.ctx,
      "flow",
      env.revision(),
      { text: "Set Team A sizes to 4 S, 6 M, 2 L", consent: true },
      async () => output([{ op: "teamSizes", teamId: "A", quantities }]),
    );
    const applied = executeOrganizerProposal(
      env.ctx,
      "flow",
      env.revision(),
      proposal.proposal!.id,
    );
    expect(applied.data.teams.find((t) => t.id === "A")!.quantities).toEqual(quantities);
    expect(applied.data.pipeline!.previews).toHaveLength(0);
  });
  it("gives local guidance and proposes quick actions without spending a model request", async () => {
    const env = await setup(),
      interpret = vi.fn(async () => output([]));
    const reply = await prepareOrganizerReply(
      env.ctx,
      "flow",
      env.revision(),
      { suggestionId: "next" },
      interpret,
    );
    expect(reply.navigation?.tab).toBe("previews");
    const proposed = await prepareOrganizerReply(
      env.ctx,
      "flow",
      env.revision(),
      { suggestionId: "preview:A:oA", section: "previews" },
      interpret,
    );
    expect(proposed.navigation).toMatchObject({ tab: "previews", teamId: "A", designId: "dA" });
    expect(interpret).not.toHaveBeenCalled();
    expect(env.ctx.db.select().from(s.jobs).all()).toHaveLength(0);
    expect(
      env.ctx.db
        .select()
        .from(s.runtimeSettings)
        .all()
        .some((r) => r.key.startsWith("assistant-last:")),
    ).toBe(false);
  });
  it("applies a combined budget, fixed shirt and plan atomically at the final revision", async () => {
    const env = await prepared();
    env.review();
    const rev = env.revision();
    const reply = await prepareOrganizerReply(
      env.ctx,
      "flow",
      rev,
      { text: "Set budget to 250, keep Shirt A and find a plan", consent: true },
      async () =>
        output([
          { op: "budget", amountMinor: 25000 },
          { op: "lock", teamId: "A", optionId: "oA" },
          { op: "runPlan" },
        ]),
    );
    expect(env.revision()).toBe(rev);
    expect(env.ctx.db.select().from(s.events).get()!.budgetMinor).toBe(10000);
    const applied = executeOrganizerProposal(env.ctx, "flow", rev, reply.proposal!.id);
    expect(applied.data.event!.budgetMinor).toBe(25000);
    expect(applied.data.pipeline!.plannerLocks).toEqual({ A: "oA" });
    const job = env.ctx.db.select().from(s.jobs).where(eq(s.jobs.id, applied.jobId!)).get()!;
    expect(job.payload).toMatchObject({ eventRevision: env.revision(), locks: { A: "oA" } });
    expect(job.estimatedUnits).toBe(0);
    await workerTick(env.ctx, { onlyKinds: ["plan"], onlyJobIds: [job.id], files: env.files });
    expect(env.ctx.db.select().from(s.plans).get()).toMatchObject({
      id: job.id,
      status: "optimal",
      stale: false,
    });
    expect(() =>
      executeOrganizerProposal(env.ctx, "flow", env.revision(), reply.proposal!.id),
    ).toThrow();
  });
  it("adds explicitly named teams with no guessed sizes and prepares every missing pairing", async () => {
    const env = await setup();
    const reply = await prepareOrganizerReply(
      env.ctx,
      "flow",
      env.revision(),
      { text: "Add Northbank and pair everyone", consent: true },
      async () =>
        output([
          { op: "addTeams", teams: [{ name: "Northbank", code: "NTH", quantities: null }] },
          { op: "roundRobin" },
        ]),
    );
    const applied = executeOrganizerProposal(env.ctx, "flow", env.revision(), reply.proposal!.id);
    expect(applied.data.teams).toHaveLength(3);
    expect(
      Object.values(applied.data.teams.find((t) => t.code === "NTH")!.quantities).reduce(
        (a, b) => a + b,
        0,
      ),
    ).toBe(0);
    expect(applied.data.fixtures).toHaveLength(3);
    expect(organizerJourney(applied.data).next.tab).toBe("teams");
    expect(assistantSuggestions(applied.data).some((s) => s.id === "round-robin")).toBe(false);
  });
  it("plans after adding missing matches in the same proposal", async () => {
    const env = await setup();
    env.ctx.db.delete(s.fixtures).run();
    const reply = await prepareOrganizerReply(
      env.ctx,
      "flow",
      env.revision(),
      { text: "Pair everyone and find a plan", consent: true },
      async () => output([{ op: "roundRobin" }, { op: "runPlan" }]),
    );
    const applied = executeOrganizerProposal(env.ctx, "flow", env.revision(), reply.proposal!.id);
    expect(applied.data.fixtures).toHaveLength(1);
    expect(applied.jobId).toBeTruthy();
  });
  it("rejects foreign IDs, duplicate edits and old proposals without partial changes", async () => {
    const env = await setup(),
      rev = env.revision();
    await expect(
      prepareOrganizerReply(env.ctx, "flow", rev, { text: "invalid", consent: true }, async () =>
        output([
          { op: "budget", amountMinor: 22000 },
          { op: "lock", teamId: "A", optionId: "outside-event" },
        ]),
      ),
    ).rejects.toThrow("isn't assigned");
    expect(env.ctx.db.select().from(s.events).get()!.budgetMinor).toBe(10000);
    env.ctx.db.delete(s.runtimeSettings).run();
    await expect(
      prepareOrganizerReply(env.ctx, "flow", rev, { text: "invalid", consent: true }, async () =>
        output([
          { op: "budget", amountMinor: 20000 },
          { op: "budget", amountMinor: 30000 },
        ]),
      ),
    ).rejects.toThrow("one clear");
    env.ctx.db.delete(s.runtimeSettings).run();
    const reply = await prepareOrganizerReply(
      env.ctx,
      "flow",
      rev,
      { text: "Set budget to 200", consent: true },
      async () => output([{ op: "budget", amountMinor: 20000 }]),
    );
    env.ctx.db
      .update(s.events)
      .set({ revision: rev + 1 })
      .run();
    expect(() => executeOrganizerProposal(env.ctx, "flow", rev + 1, reply.proposal!.id)).toThrow(
      "outdated",
    );
    expect(env.ctx.db.select().from(s.jobs).all()).toHaveLength(0);
  });
  it("discards all edits if the model needs clarification and catches concurrent changes", async () => {
    const env = await setup();
    const reply = await prepareOrganizerReply(
      env.ctx,
      "flow",
      env.revision(),
      { text: "Some ambiguous request", consent: true },
      async () => ({
        ...output([{ op: "budget", amountMinor: 50000 }]),
        questions: ["Which team?"],
      }),
    );
    expect(reply.proposal).toBeUndefined();
    expect(reply.facts).toEqual(["Which team?"]);
    expect(env.ctx.db.select().from(s.assistantDrafts).all()).toHaveLength(0);
    env.ctx.db.delete(s.runtimeSettings).run();
    const rev = env.revision();
    await expect(
      prepareOrganizerReply(
        env.ctx,
        "flow",
        rev,
        { text: "Set budget", consent: true },
        async () => {
          env.ctx.db
            .update(s.events)
            .set({ revision: rev + 1 })
            .run();
          return output([{ op: "budget", amountMinor: 20000 }]);
        },
      ),
    ).rejects.toThrow();
  });
  it("creates a photo-free brief only from an already confirmed current plan", async () => {
    const env = await prepared();
    env.review();
    await expect(
      prepareOrganizerReply(
        env.ctx,
        "flow",
        env.revision(),
        { text: "Prepare brief", consent: true },
        async () => output([{ op: "prepareBrief" }]),
      ),
    ).rejects.toThrow("confirm");
    env.command("queuePlan", { locks: {}, baseline: { A: "oA", B: "oB" } });
    await workerTick(env.ctx, { onlyKinds: ["plan"], files: env.files });
    const plan = env.ctx.db.select().from(s.plans).get()!;
    orderCommand(env.ctx, {
      op: "confirmPlan",
      eventId: "flow",
      revision: env.revision(),
      planId: plan.id,
      reviewer: "Test organizer",
    });
    const reply = await prepareOrganizerReply(env.ctx, "flow", env.revision(), {
      suggestionId: "brief",
    });
    const applied = executeOrganizerProposal(env.ctx, "flow", env.revision(), reply.proposal!.id);
    expect(applied.data.pipeline!.briefs).toHaveLength(1);
    expect(env.ctx.db.select().from(s.exportsTable).get()!.snapshot).toMatchObject({
      includePlayerPhotos: false,
    });
    expect(organizerJourney(applied.data).completed).toBe(5);
  });
  it("uses a structured text-only free-model request, verified with a mocked transport", async () => {
    const env = await setup();
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-only");
    const result = output([{ op: "budget", amountMinor: 30050 }]);
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
                message: { role: "assistant", content: JSON.stringify(result) },
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
        await interpretOrganizer("Set budget to EUR 300.50", getWorkspace(env.ctx, "flow")),
      ).toEqual(result);
      const args = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(args[1].body));
      expect(args[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(body.model).toBe("nvidia/nemotron-3.5-super-vl:free");
      expect(body.response_format.type).toBe("json_schema");
      expect(body.tools).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("image_url");
      const context = JSON.stringify(agentContext(getWorkspace(env.ctx, "flow")));
      expect(context).not.toContain("relativePath");
      expect(context).not.toContain("basis");
      expect(
        agentOutputSchema.safeParse({ ...output([]), actions: [{ op: "approveMatch" }] }).success,
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

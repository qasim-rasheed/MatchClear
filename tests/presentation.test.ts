import { describe, expect, it } from "vitest";
import { showcaseInput, showcaseStages, inspectSelection } from "../src/lib/planner/showcase";
import { runBenchmark, enumerate } from "../src/lib/planner/benchmark";
import { solve } from "../src/lib/planner/solve";
import { eventProgress } from "../src/lib/progress";
import { getWorkspace } from "../src/server/workspace";
import { bumpEvent } from "../src/server/evidence";
import { prepared, setup } from "./helpers/workflow";
import { workerTick } from "../src/worker/process";
import { orderCommand } from "../src/server/orders";

describe("reproducible presentation evidence", () => {
  it("independently verifies the fewest-changes objective when two equal-cost selections exist", () => {
    const input = showcaseInput();
    const spare = input.candidates.find((c) => c.id === "Dn")!;
    input.candidates.push({ ...spare, id: "Dspare" });
    input.decisions.push(
      ...input.decisions
        .filter((d) => d.optionB === "Dn")
        .map((d) => ({ ...d, optionB: "Dspare" })),
    );
    input.baseline.D = "Dspare";
    const expected = enumerate(input),
      actual = solve(input);
    expect(expected).toEqual({ totalMinor: 21600, changes: 1 });
    expect(actual.totalMinor).toBe(expected.totalMinor);
    expect(actual.changes).toBe(expected.changes);
    expect(actual.selection?.D).toBe("Dspare");
  });
  it("shows the conflict moving after the local fix and resolves the whole graph", () => {
    const input = showcaseInput(),
      stages = showcaseStages();
    const results = stages.map((s) => inspectSelection(input, s.selection));
    expect(results.map((r) => r.costMinor)).toEqual([0, 14400, 21600]);
    expect(results[0].fixtures.filter((f) => f.status !== "approved").map((f) => f.id)).toEqual([
      "AB",
    ]);
    expect(results[1].fixtures.filter((f) => f.status !== "approved").map((f) => f.id)).toEqual([
      "BC",
    ]);
    expect(results[2].fixtures.every((f) => f.status === "approved")).toBe(true);
    expect(inspectSelection(input, { ...input.baseline, B: "Bn", C: "Cw" }).costMinor).toBe(44400);
  });
  it("does not hide a fixed-shirt constraint behind the successful showcase", () => {
    const input = showcaseInput();
    expect(solve({ ...input, locks: { D: "Dw" } }).status).toBe("infeasible");
    expect(solve({ ...input, locks: { D: "Dw" }, budgetMinor: 50000 }).totalMinor).toBe(44400);
    expect(solve({ ...input, decisions: [] }).status).toBe("incomplete");
  });
  it("matches independent enumeration including ties and constraints in the published 500-case matrix", () => {
    const report = runBenchmark();
    expect(report.matchedIndependentEnumeration).toBe(500);
    expect(report.invalidSelections).toBe(0);
    expect(report.feasibleCases + report.infeasibleCases).toBe(500);
    expect(report.failedCaseIndexes).toEqual([]);
  });
});

describe("next-action guidance", () => {
  it("starts with previews when saved photos have not produced accepted evidence", async () => {
    const env = await setup();
    expect(eventProgress(getWorkspace(env.ctx, "flow")).tab).toBe("previews");
  });
  it("advances through reviews, planning and export, then revisits outdated inputs", async () => {
    const env = await prepared();
    const workspace = () => getWorkspace(env.ctx, "flow");
    expect(eventProgress(workspace()).tab).toBe("reviews");
    env.review();
    expect(eventProgress(workspace()).tab).toBe("plan");
    env.command("queuePlan", { locks: {}, baseline: { A: "oA", B: "oB" } });
    await workerTick(env.ctx, { onlyKinds: ["plan"], files: env.files });
    const data = workspace(),
      plan = data.pipeline!.plans[0];
    expect(eventProgress(data).tab).toBe("brief");
    const c = orderCommand(env.ctx, {
      op: "confirmPlan",
      eventId: "flow",
      revision: env.revision(),
      planId: plan.id,
      reviewer: "Synthetic fixture",
    });
    orderCommand(env.ctx, {
      op: "createBrief",
      eventId: "flow",
      revision: env.revision(),
      confirmationId: c.id,
    });
    expect(eventProgress(workspace()).checks).toEqual([true, true, true, true, true]);
    bumpEvent(env.ctx, "flow", "test.planning-input-change", "flow");
    expect(eventProgress(workspace()).tab).toBe("plan");
    env.command("deleteAsset", { assetId: env.a.referenceAssetId });
    expect(eventProgress(workspace()).tab).toBe("previews");
  });
  it("allows reviewing with one accepted choice per team even when an alternative lacks a preview", async () => {
    const env = await prepared(),
      data = getWorkspace(env.ctx, "flow");
    data.options.push({ ...data.options[0], id: "optional-extra", designId: "not-rendered" });
    expect(eventProgress(data).tab).toBe("reviews");
  });
});

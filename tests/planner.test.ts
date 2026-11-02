import { describe, expect, it } from "vitest";
import { solve, type PlanningInput } from "../src/lib/planner/solve";
function example(): PlanningInput {
  const teams = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
  const fixtures = [
    ["A", "B"],
    ["B", "C"],
    ["A", "D"],
  ].map(([teamA, teamB], i) => ({ id: `f${i}`, label: `Match ${i}`, teamA, teamB }));
  const candidates = [
    ["Ar", "A", 0],
    ["Aw", "A", 18],
    ["Bg", "B", 0],
    ["Bn", "B", 12],
    ["Cn", "C", 0],
    ["Cw", "C", 25],
    ["Dw", "D", 0],
    ["Dn", "D", 0],
  ].map(([id, teamId, costMinor]) => ({
    id: String(id),
    teamId: String(teamId),
    designId: String(id),
    label: String(id),
    costMinor: Number(costMinor),
    visualReady: true,
  }));
  const pairs = new Set(["nr", "rw", "gn", "gw", "nw"]);
  const decisions = fixtures.flatMap((f) =>
    candidates
      .filter((c) => c.teamId === f.teamA)
      .flatMap((a) =>
        candidates
          .filter((c) => c.teamId === f.teamB)
          .map((b) => ({
            fixtureId: f.id,
            optionA: a.id,
            optionB: b.id,
            status: pairs.has([a.id[1], b.id[1]].sort().join(""))
              ? ("approved" as const)
              : ("rejected" as const),
          })),
      ),
  );
  return {
    teams,
    fixtures,
    candidates,
    decisions,
    budgetMinor: 100,
    locks: {},
    baseline: { A: "Ar", B: "Bg", C: "Cn", D: "Dw" },
    excluded: [],
  };
}
describe("reviewed tournament planner", () => {
  it("resolves the entire fixture graph rather than taking a cheaper local change", () => {
    const input = example();
    const result = solve(input);
    expect(result.status).toBe("optimal");
    expect(result.totalMinor).toBe(18);
    expect(result.selection).toEqual({ A: "Aw", B: "Bg", C: "Cn", D: "Dn" });
    expect(solve({ ...input, budgetMinor: 17 }).status).toBe("infeasible");
    expect(solve({ ...input, locks: { D: "Dw" } }).totalMinor).toBe(37);
    expect(solve({ ...input, locks: { A: "Ar", C: "Cn" } }).status).toBe("infeasible");
  });
  it("identifies missing evidence and never converts an unknown pair into an approved plan", () => {
    const input = example();
    input.decisions = [];
    const result = solve(input);
    expect(result.status).toBe("incomplete");
    expect(result.selection).toBeNull();
    expect(result.missingReviews.length).toBe(3);
    input.candidates.forEach((c) => (c.visualReady = false));
    expect(solve(input).missingPreviews).toHaveLength(4);
  });
  it("distinguishes cancellation and search limits from impossibility", () => {
    expect(solve(example(), { maxNodes: 0 }).status).toBe("limit");
    expect(solve(example(), { cancelled: () => true }).status).toBe("cancelled");
  });
  it("matches an independent complete enumerator on 100 deterministic small graphs", () => {
    let state = 2193;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let run = 0; run < 100; run++) {
      const teams = ["A", "B", "C"].map((id) => ({ id, name: id }));
      const candidates = teams.flatMap((t) =>
        [0, 1].map((n) => ({
          id: `${t.id}${n}`,
          teamId: t.id,
          designId: `${t.id}${n}`,
          label: "Example",
          costMinor: Math.floor(random() * 20),
          visualReady: true,
        })),
      );
      const fixtures = [
        { id: "AB", label: "AB", teamA: "A", teamB: "B" },
        { id: "BC", label: "BC", teamA: "B", teamB: "C" },
      ];
      const decisions = fixtures.flatMap((f) =>
        candidates
          .filter((o) => o.teamId === f.teamA)
          .flatMap((a) =>
            candidates
              .filter((o) => o.teamId === f.teamB)
              .map((b) => ({
                fixtureId: f.id,
                optionA: a.id,
                optionB: b.id,
                status: random() > 0.4 ? ("approved" as const) : ("rejected" as const),
              })),
          ),
      );
      const input: PlanningInput = {
        teams,
        candidates,
        fixtures,
        decisions,
        budgetMinor: 30,
        baseline: {},
        locks: {},
        excluded: [],
      };
      let best = Infinity;
      for (const a of candidates.filter((o) => o.teamId === "A"))
        for (const b of candidates.filter((o) => o.teamId === "B"))
          for (const c of candidates.filter((o) => o.teamId === "C")) {
            const choice = { A: a.id, B: b.id, C: c.id };
            const cost = a.costMinor + b.costMinor + c.costMinor;
            if (
              cost <= 30 &&
              fixtures.every((f) =>
                decisions.some(
                  (d) =>
                    d.fixtureId === f.id &&
                    d.optionA === choice[f.teamA as "A"] &&
                    d.optionB === choice[f.teamB as "B"] &&
                    d.status === "approved",
                ),
              )
            )
              best = Math.min(best, cost);
          }
      const result = solve(input);
      expect(result.totalMinor).toBe(best === Infinity ? null : best);
      expect(result.status).toBe(best === Infinity ? "infeasible" : "optimal");
    }
  });
});

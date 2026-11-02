import { solve, type PlanningInput } from "./solve";

// Independent full Cartesian enumeration; no solver helpers or pruning.
export function enumerate(input: PlanningInput) {
  let best = Infinity,
    changes = Infinity;
  const visit = (i: number, choice: Record<string, string>, cost: number, edits: number) => {
    if (i === input.teams.length) {
      if (
        cost > input.budgetMinor ||
        !input.fixtures.every((f) =>
          input.decisions.some(
            (d) =>
              d.fixtureId === f.id &&
              d.optionA === choice[f.teamA] &&
              d.optionB === choice[f.teamB] &&
              d.status === "approved",
          ),
        )
      )
        return;
      if (cost < best || (cost === best && edits < changes)) {
        best = cost;
        changes = edits;
      }
      return;
    }
    const team = input.teams[i];
    for (const c of input.candidates.filter(
      (c) =>
        c.teamId === team.id &&
        c.visualReady &&
        (!input.locks[team.id] || input.locks[team.id] === c.id),
    )) {
      visit(
        i + 1,
        { ...choice, [team.id]: c.id },
        cost + c.costMinor,
        edits + Number(Boolean(input.baseline[team.id] && input.baseline[team.id] !== c.id)),
      );
    }
  };
  visit(0, {}, 0, 0);
  return {
    totalMinor: best === Infinity ? null : best,
    changes: changes === Infinity ? null : changes,
  };
}
export function runBenchmark(count = 500, seed = 2193) {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let matches = 0,
    feasible = 0,
    infeasible = 0,
    invalidSelections = 0;
  const durations: number[] = [],
    failures: number[] = [];
  for (let run = 0; run < count; run++) {
    const teams = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
    const candidates = teams.flatMap((t) =>
      [0, 1].map((n) => ({
        id: `${t.id}${n}`,
        teamId: t.id,
        designId: `${t.id}${n}`,
        label: `${t.id}${n}`,
        costMinor: n ? Math.floor(random() * 30000) : 0,
        visualReady: true,
      })),
    );
    const fixtures = [
      ["A", "B"],
      ["B", "C"],
      ["C", "D"],
      ["A", "D"],
    ].map(([teamA, teamB]) => ({ id: teamA + teamB, label: teamA + teamB, teamA, teamB }));
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
              status: random() > 0.4 ? ("approved" as const) : ("rejected" as const),
            })),
        ),
    );
    const baseline = Object.fromEntries(teams.map((t) => [t.id, `${t.id}0`]));
    const locks: Record<string, string> = run % 3 === 0 ? { A: `A${Number(random() > 0.5)}` } : {};
    const input: PlanningInput = {
      teams,
      candidates,
      fixtures,
      decisions,
      baseline,
      locks,
      budgetMinor: Math.floor(random() * 50000),
      excluded: [],
    };
    const expected = enumerate(input),
      actual = solve(input);
    durations.push(actual.elapsedMs);
    if (actual.selection) {
      feasible++;
      const selection = actual.selection;
      const cost = teams.reduce(
        (sum, t) => sum + candidates.find((c) => c.id === selection[t.id])!.costMinor,
        0,
      );
      if (
        cost > input.budgetMinor ||
        Object.entries(locks).some(([t, id]) => selection[t] !== id) ||
        !fixtures.every((f) =>
          decisions.some(
            (d) =>
              d.fixtureId === f.id &&
              d.optionA === selection[f.teamA] &&
              d.optionB === selection[f.teamB] &&
              d.status === "approved",
          ),
        )
      )
        invalidSelections++;
    } else infeasible++;
    if (
      actual.totalMinor === expected.totalMinor &&
      actual.changes === expected.changes &&
      actual.status === (expected.totalMinor === null ? "infeasible" : "optimal")
    )
      matches++;
    else failures.push(run);
  }
  durations.sort((a, b) => a - b);
  return {
    schemaVersion: 1,
    kind: "synthetic-software-benchmark",
    seed,
    cases: count,
    teamsPerCase: 4,
    optionsPerTeam: 2,
    fixturesPerCase: 4,
    matchedIndependentEnumeration: matches,
    feasibleCases: feasible,
    infeasibleCases: infeasible,
    invalidSelections,
    medianSolverMs: durations[Math.floor(durations.length / 2)],
    maxSolverMs: durations.at(-1),
    failedCaseIndexes: failures,
    limitations:
      "Seeded synthetic approvals, inventory and costs. Tests planner correctness and tie-breaking, not garment accuracy, user benefit, accessibility, or money saved by real organizers.",
  };
}

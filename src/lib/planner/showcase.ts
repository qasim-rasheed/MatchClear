import { solve, type PlanningInput } from "./solve";

// Synthetic teaching fixture. These decisions are never written to real event evidence.
export function showcaseInput(): PlanningInput {
  const teams = [
    { id: "A", name: "Northbank" },
    { id: "B", name: "Parkside" },
    { id: "C", name: "Riverside" },
    { id: "D", name: "Old Town" },
  ];
  const fixtures = [
    { id: "AB", teamA: "A", teamB: "B", label: "Northbank vs Parkside" },
    { id: "BC", teamA: "B", teamB: "C", label: "Parkside vs Riverside" },
    { id: "AD", teamA: "A", teamB: "D", label: "Northbank vs Old Town" },
  ];
  const candidates = [
    ["Ar", "A", "Red home", 0],
    ["Aw", "A", "White alternate", 21600],
    ["Bg", "B", "Green home", 0],
    ["Bn", "B", "Navy alternate", 14400],
    ["Cn", "C", "Navy home", 0],
    ["Cw", "C", "White alternate", 30000],
    ["Dw", "D", "White home", 0],
    ["Dn", "D", "Navy spare", 0],
  ].map(([id, teamId, label, costMinor]) => ({
    id: String(id),
    teamId: String(teamId),
    designId: String(id),
    label: String(label),
    costMinor: Number(costMinor),
    visualReady: true,
  }));
  const allowed = new Set(["nr", "rw", "gn", "gw", "nw"]);
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
            status: allowed.has([a.id[1], b.id[1]].sort().join(""))
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
    budgetMinor: 30000,
    locks: {},
    baseline: { A: "Ar", B: "Bg", C: "Cn", D: "Dw" },
    excluded: [],
  };
}
export function inspectSelection(input: PlanningInput, selection: Record<string, string>) {
  return {
    costMinor: input.teams.reduce(
      (sum, t) => sum + (input.candidates.find((c) => c.id === selection[t.id])?.costMinor || 0),
      0,
    ),
    fixtures: input.fixtures.map((f) => ({
      ...f,
      status:
        input.decisions.find(
          (d) =>
            d.fixtureId === f.id &&
            d.optionA === selection[f.teamA] &&
            d.optionB === selection[f.teamB],
        )?.status || "pending",
    })),
  };
}
export function showcaseStages() {
  const input = showcaseInput();
  const result = solve(input);
  return [
    {
      title: "Start with owned shirts",
      selection: input.baseline,
      detail:
        "The supplied decision rejects Northbank vs Parkside. The other two fixtures are approved in this synthetic example.",
    },
    {
      title: "Fix only the first match",
      selection: { ...input.baseline, B: "Bn" },
      detail:
        "Buying Parkside's navy alternate costs €144 and fixes the first fixture, but Parkside now faces Riverside in navy. One conflict moved to another match.",
    },
    {
      title: "Plan the whole event",
      selection: result.selection!,
      detail:
        "Northbank buys white for €216. Old Town uses its already-owned navy spare. All three supplied opposing-pair decisions are approved, within the €300 budget.",
    },
  ];
}

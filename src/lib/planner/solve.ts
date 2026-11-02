export type Candidate = {
  id: string;
  teamId: string;
  designId: string;
  label: string;
  costMinor: number;
  visualReady: boolean;
};
export type PairDecision = {
  fixtureId: string;
  optionA: string;
  optionB: string;
  status: "approved" | "rejected" | "inconclusive" | "pending";
};
export type PlanningInput = {
  teams: { id: string; name: string }[];
  fixtures: { id: string; teamA: string; teamB: string; label: string }[];
  candidates: Candidate[];
  decisions: PairDecision[];
  budgetMinor: number;
  locks: Record<string, string>;
  baseline: Record<string, string>;
  excluded: { teamId: string; optionId: string; reason: string }[];
};
export type PlanResult = {
  status: "optimal" | "feasible" | "infeasible" | "incomplete" | "limit" | "cancelled";
  selection: Record<string, string> | null;
  totalMinor: number | null;
  changes: number | null;
  nodes: number;
  elapsedMs: number;
  explanations: string[];
  missingReviews: { fixtureId: string; optionA: string; optionB: string }[];
  missingPreviews: string[];
};

export function solve(
  input: PlanningInput,
  settings: { maxNodes?: number; maxMs?: number; cancelled?: () => boolean } = {},
): PlanResult {
  const started = Date.now();
  let nodes = 0;
  let limited = false;
  let cancelled = false;
  const maxNodes = settings.maxNodes ?? 250_000;
  const maxMs = settings.maxMs ?? 2000;
  const decisions = new Map(
    input.decisions.map((d) => [`${d.fixtureId}|${d.optionA}|${d.optionB}`, d.status]),
  );
  const choices = new Map(
    input.teams.map((t) => [
      t.id,
      input.candidates
        .filter((o) => o.teamId === t.id && (!input.locks[t.id] || input.locks[t.id] === o.id))
        .sort((a, b) => a.costMinor - b.costMinor || a.id.localeCompare(b.id)),
    ]),
  );
  const result = (value: Partial<PlanResult> & Pick<PlanResult, "status">): PlanResult => ({
    selection: null,
    totalMinor: null,
    changes: null,
    explanations: [],
    missingReviews: [],
    missingPreviews: [],
    ...value,
    nodes,
    elapsedMs: Date.now() - started,
  });
  if (!input.teams.length)
    return result({ status: "incomplete", explanations: ["Add teams before planning."] });
  if (input.teams.length > 16 || input.candidates.length > 64)
    return result({
      status: "limit",
      explanations: [
        "This exact planner supports up to 16 teams and 64 eligible shirt options per run. Narrow the event before planning.",
      ],
    });
  const empty = input.teams.filter((t) => !choices.get(t.id)?.length);
  if (empty.length)
    return result({
      status: "infeasible",
      explanations: empty.map(
        (t) =>
          `${t.name} has no option satisfying its recorded stock, size allocation and lock. Check the excluded options.`,
      ),
    });
  const order = [...input.teams].sort(
    (a, b) => choices.get(a.id)!.length - choices.get(b.id)!.length || a.id.localeCompare(b.id),
  );
  type Found = { selection: Record<string, string>; cost: number; changes: number };
  const lookup = new Map(input.candidates.map((o) => [o.id, o]));
  const search = (optimistic: boolean): Found | null => {
    let best: Found | null = null;
    const lower = order.map((t) => Math.min(...choices.get(t.id)!.map((o) => o.costMinor)));
    const remaining = lower.map((_, i) => lower.slice(i).reduce((a, b) => a + b, 0));
    const visit = (
      index: number,
      chosen: Record<string, string>,
      cost: number,
      changes: number,
    ) => {
      nodes++;
      if (nodes > maxNodes || Date.now() - started > maxMs) {
        limited = true;
        return;
      }
      if (nodes === 1 || nodes % 100 === 0)
        if (settings.cancelled?.()) {
          cancelled = true;
          return;
        }
      if (cancelled || limited || cost > input.budgetMinor || (best && cost > best.cost)) return;
      if (
        index < order.length &&
        cost + remaining[index] > Math.min(input.budgetMinor, best?.cost ?? Infinity)
      )
        return;
      if (index === order.length) {
        if (!best || cost < best.cost || (cost === best.cost && changes < best.changes))
          best = { selection: { ...chosen }, cost, changes };
        return;
      }
      const team = order[index];
      for (const candidate of choices.get(team.id)!) {
        if (!optimistic && !candidate.visualReady) continue;
        chosen[team.id] = candidate.id;
        const conflict = input.fixtures.some((f) => {
          if (!chosen[f.teamA] || !chosen[f.teamB]) return false;
          const status =
            decisions.get(`${f.id}|${chosen[f.teamA]}|${chosen[f.teamB]}`) || "pending";
          return optimistic ? status === "rejected" : status !== "approved";
        });
        if (!conflict)
          visit(
            index + 1,
            chosen,
            cost + candidate.costMinor,
            changes +
              Number(Boolean(input.baseline[team.id]) && input.baseline[team.id] !== candidate.id),
          );
        delete chosen[team.id];
        if (cancelled || limited) break;
      }
    };
    visit(0, {}, 0, 0);
    return best;
  };
  const strict = search(false);
  if (cancelled) return result({ status: "cancelled", explanations: ["Planning was cancelled."] });
  if (strict)
    return result({
      status: limited ? "feasible" : "optimal",
      selection: strict.selection,
      totalMinor: strict.cost,
      changes: strict.changes,
      explanations: [
        limited
          ? "A feasible plan was found before the search limit; the lowest cost is not proven."
          : "Lowest recorded cost among current human-approved combinations, with fewer changes used to break cost ties.",
      ],
    });
  if (limited)
    return result({
      status: "limit",
      explanations: ["The search limit was reached. No impossibility claim can be made."],
    });
  const possible = search(true);
  if (cancelled) return result({ status: "cancelled", explanations: ["Planning was cancelled."] });
  if (possible) {
    const missingReviews = input.fixtures
      .filter(
        (f) =>
          decisions.get(`${f.id}|${possible.selection[f.teamA]}|${possible.selection[f.teamB]}`) !==
          "approved",
      )
      .map((f) => ({
        fixtureId: f.id,
        optionA: possible.selection[f.teamA],
        optionB: possible.selection[f.teamB],
      }));
    const missingPreviews = Object.values(possible.selection).filter(
      (id) => !lookup.get(id)!.visualReady,
    );
    return result({
      status: "incomplete",
      missingReviews,
      missingPreviews,
      explanations: [
        "A potential selection still needs accepted previews or human reviews. It is not an approved plan.",
      ],
    });
  }
  return result({
    status: limited ? "limit" : "infeasible",
    explanations: [
      limited
        ? "The search limit was reached while checking unresolved combinations."
        : "No selection satisfies the supplied budget, stock, locks and recorded rejections, even with unresolved pairs treated as potentially approvable. No rules were relaxed.",
    ],
  });
}

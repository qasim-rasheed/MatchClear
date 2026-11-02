import type { Workspace } from "../server/workspace";
import { supportedRegion } from "../domain/pipeline";

export function eventProgress(data: Workspace) {
  const setup =
    data.teams.length >= 2 &&
    data.fixtures.length > 0 &&
    data.teams.every((t) => data.options.some((o) => o.teamId === t.id));
  const previews =
    setup &&
    data.teams.every((t) =>
      data.pipeline?.previews.some(
        (p) => p.teamId === t.id && p.usable && supportedRegion(p.region),
      ),
    );
  const reviews =
    previews &&
    data.fixtures.every((f) =>
      data.pipeline?.reviews.some((r) => r.fixtureId === f.id && r.current),
    );
  const plan = data.pipeline?.plans.find(
    (p) => !p.stale && ["optimal", "feasible"].includes(p.status),
  );
  const brief = Boolean(
    data.pipeline?.briefs.some((b) =>
      data.pipeline?.plans.some((p) => p.id === b.planId && !p.stale),
    ),
  );
  const checks = [setup, previews, reviews, Boolean(plan), brief];
  const next = checks.findIndex((done) => !done);
  const current = next < 0 ? 4 : next;
  const actions = [
    {
      tab: "teams",
      title: "Complete the event inputs",
      body: "Add at least two teams, their shirt options and who plays whom.",
    },
    {
      tab: "previews",
      title: "Prepare the preview evidence",
      body: "Each team needs a usable on-person preview and a confirmed shirt area. Extra alternatives can be added later.",
    },
    {
      tab: "reviews",
      title: "Review the opposing combinations",
      body: "Compare references and previews. Record your decision and why; inconclusive is a valid result.",
    },
    {
      tab: "plan",
      title: "Find a complete tournament plan",
      body: "Use the recorded reviews, stock and budget. Missing combinations remain unapproved.",
    },
    {
      tab: "brief",
      title: brief ? "Your order brief is ready" : "Confirm and create the order brief",
      body: brief
        ? "Open your saved brief and check supplier availability before ordering."
        : "Check the complete plan in Tournament Plan, confirm it, then create a brief for the seller.",
    },
  ] as const;
  return { checks, current, ...actions[current] };
}

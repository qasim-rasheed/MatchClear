import type { Workspace } from "../server/workspace";
import type { OrganizerSection, AssistantSuggestion } from "../domain/assistant-agent";
import { supportedRegion } from "../domain/pipeline";
import { totalQuantity, formatMoney } from "../domain/validation";

export function organizerJourney(data: Workspace) {
  const event = data.event;
  const teamsReady =
    data.teams.length >= 2 && data.teams.every((t) => totalQuantity(t.quantities) > 0);
  const eventReady = teamsReady && data.fixtures.length > 0;
  const shirtsReady =
    data.teams.length > 0 && data.teams.every((t) => data.options.some((o) => o.teamId === t.id));
  const previewsReady =
    shirtsReady &&
    data.teams.every((t) =>
      data.pipeline?.previews.some(
        (p) => p.teamId === t.id && p.usable && supportedRegion(p.region),
      ),
    );
  const reviewsReady =
    data.fixtures.length > 0 &&
    data.fixtures.every((f) =>
      data.pipeline?.reviews.some((r) => r.fixtureId === f.id && r.current),
    );
  const plan = data.pipeline?.plans.find(
    (p) => !p.stale && ["optimal", "feasible"].includes(p.status),
  );
  const confirmed = Boolean(plan && data.pipeline?.confirmations.some((c) => c.planId === plan.id));
  const briefReady = Boolean(plan && data.pipeline?.briefs.some((b) => b.planId === plan.id));
  const stages = [
    {
      id: "event",
      label: "Event",
      tab: "teams" as OrganizerSection,
      done: eventReady,
      tabs: ["teams", "fixtures"],
    },
    {
      id: "shirts",
      label: "Shirts",
      tab: "shirts" as OrganizerSection,
      done: shirtsReady,
      tabs: ["shirts"],
    },
    {
      id: "preview",
      label: "Preview",
      tab: "previews" as OrganizerSection,
      done: previewsReady,
      tabs: ["previews"],
    },
    {
      id: "compare",
      label: "Compare",
      tab: "reviews" as OrganizerSection,
      done: reviewsReady,
      tabs: ["reviews"],
    },
    {
      id: "order",
      label: "Plan & order",
      tab: confirmed ? ("brief" as OrganizerSection) : ("plan" as OrganizerSection),
      done: briefReady,
      tabs: ["plan", "brief"],
    },
  ];
  let next: {
    tab: OrganizerSection;
    title: string;
    body: string;
    button: string;
    editor?: "team" | "fixture" | "option" | "event";
  };
  if (!event)
    next = {
      tab: "overview",
      title: "Let's set up your tournament",
      body: "Give it a name and a shirt budget. We'll guide you through the rest.",
      button: "Create tournament",
      editor: "event",
    };
  else if (data.teams.length < 2)
    next = {
      tab: "teams",
      title: "Who is taking part?",
      body: "Add at least two teams and the shirt sizes they need.",
      button: "Add a team",
      editor: "team",
    };
  else if (!teamsReady)
    next = {
      tab: "teams",
      title: "Add your team sizes",
      body: "Enter the sizes and quantities so the order includes everyone.",
      button: "Set team sizes",
    };
  else if (!data.fixtures.length)
    next = {
      tab: "fixtures",
      title: "Who plays whom?",
      body: "Add your matches, or ask the assistant to prepare all pairings.",
      button: "Add matches",
    };
  else if (!shirtsReady)
    next = {
      tab: "shirts",
      title: "Choose the shirt options",
      body: "Add owned shirts or new options for each team. Include the price and available sizes.",
      button: "Choose shirts",
    };
  else if (!previewsReady)
    next = {
      tab: "previews",
      title: "See the shirts on a player",
      body: "Add permitted photos, make a preview and check how the shirt is represented.",
      button: "Preview shirts",
    };
  else if (!reviewsReady)
    next = {
      tab: "reviews",
      title: "Check the opposing shirts",
      body: "Compare each matchup and record what works, what doesn't, or what needs another look.",
      button: "Compare matchups",
    };
  else if (!plan)
    next = {
      tab: "plan",
      title: "Find a plan for the whole tournament",
      body: "Bring your reviews, shirt sizes, availability and budget together.",
      button: "Choose a plan",
    };
  else if (!confirmed)
    next = {
      tab: "plan",
      title: "Your plan is ready to check",
      body: "Review the selected shirts and order costs, then confirm your choice.",
      button: "Check the plan",
    };
  else if (!briefReady)
    next = {
      tab: "brief",
      title: "Prepare the seller's brief",
      body: "Save the chosen designs, quantities and costs in one clear document.",
      button: "Create order brief",
    };
  else
    next = {
      tab: "brief",
      title: "Your order brief is ready",
      body: "Open your saved brief and confirm availability with the seller before ordering.",
      button: "Open order brief",
    };
  return {
    stages,
    next,
    plan,
    confirmed,
    briefReady,
    completed: stages.filter((s) => s.done).length,
    shirts: data.teams.reduce((n, t) => n + totalQuantity(t.quantities), 0),
  };
}
export function assistantSuggestions(
  data: Workspace,
  section: OrganizerSection = "overview",
): AssistantSuggestion[] {
  const journey = organizerJourney(data),
    event = data.event;
  const suggestions: (AssistantSuggestion & { priority: number })[] = [];
  const add = (suggestion: AssistantSuggestion, priority: number, relevant?: OrganizerSection[]) =>
    suggestions.push({
      ...suggestion,
      priority: priority + (relevant?.includes(section) ? 10 : 0),
    });
  add(
    {
      id: "next",
      kind: "guide",
      label: journey.next.button,
      prompt: `What should I do next in ${event?.name || "this tournament"}?`,
    },
    6,
  );
  if (!event) return suggestions;
  for (const team of data.teams) {
    if (!totalQuantity(team.quantities))
      add(
        {
          id: `sizes:${team.id}`,
          kind: "navigate",
          label: `Set ${team.name}'s sizes`,
          prompt: `Show me where to enter the shirt sizes for ${team.name}.`,
          navigation: { tab: "teams", label: "Enter team sizes", teamId: team.id },
        },
        8,
        ["teams"],
      );
    const options = data.options.filter((o) => o.teamId === team.id);
    if (!options.length)
      add(
        {
          id: `shirts:${team.id}`,
          kind: "navigate",
          label: `Choose ${team.name}'s shirts`,
          prompt: `Help me add shirt options for ${team.name}.`,
          navigation: { tab: "shirts", label: "Choose shirt options", teamId: team.id },
        },
        7,
        ["shirts"],
      );
    for (const option of options) {
      const design = data.designs.find((d) => d.id === option.designId);
      const preview = data.pipeline?.previews.find(
        (p) =>
          p.teamId === team.id &&
          p.designId === option.designId &&
          !p.stale &&
          p.status !== "deleted",
      );
      if (preview?.usable && supportedRegion(preview.region)) continue;
      const action =
        !team.personAssetId || !design?.assetId
          ? "Add photos for"
          : !preview?.outputAssetId
            ? "Preview"
            : preview.acceptance !== "accepted"
              ? "Check the preview for"
              : "Outline the shirt for";
      add(
        {
          id: `preview:${team.id}:${option.id}`,
          kind: "navigate",
          label: `${action} ${team.name}`,
          prompt: `${action} ${team.name} using ${design?.name || "their assigned shirt"}. What is still needed?`,
          navigation: {
            tab: "previews",
            label:
              action === "Add photos for"
                ? "Add the two photos"
                : action === "Outline the shirt for"
                  ? "Mark the shirt area"
                  : "Open this preview",
            teamId: team.id,
            designId: option.designId,
          },
        },
        5,
        ["previews"],
      );
    }
  }
  const unresolved = data.fixtures.filter(
    (f) =>
      !data.pipeline?.reviews.some(
        (r) => r.fixtureId === f.id && r.current && r.status !== "inconclusive",
      ),
  );
  const previewsReady = journey.stages[2].done;
  if (previewsReady)
    for (const fixture of unresolved.slice(0, 2)) {
      const names = [fixture.teamA, fixture.teamB]
        .map((id) => data.teams.find((t) => t.id === id)?.name || "Team")
        .join(" vs ");
      add(
        {
          id: `review:${fixture.id}`,
          kind: "navigate",
          label: `Compare ${names}`,
          prompt: `Take me to the unfinished ${names} comparison.`,
          navigation: { tab: "reviews", label: "Compare these shirts", fixtureId: fixture.id },
        },
        8,
        ["reviews"],
      );
    }
  const totalPairs = (data.teams.length * (data.teams.length - 1)) / 2,
    missingPairs = totalPairs - data.fixtures.length;
  if (data.teams.length >= 2 && data.teams.length <= 16 && missingPairs > 0)
    add(
      {
        id: "round-robin",
        kind: "roundRobin",
        label: `Add ${missingPairs} missing pairing${missingPairs === 1 ? "" : "s"}`,
        prompt: `Prepare the ${missingPairs} missing pairings so each of our ${data.teams.length} teams plays every other once.`,
      },
      3,
      ["teams", "fixtures"],
    );
  const hasPlanJob = data.pipeline?.jobs.some(
    (j) => j.kind === "plan" && ["queued", "running"].includes(j.status),
  );
  const latest = data.pipeline?.plans[0];
  const readyForPlan =
    data.teams.length >= 2 &&
    data.fixtures.length > 0 &&
    journey.stages[1].done &&
    journey.stages[3].done;
  if (readyForPlan && !hasPlanJob && (!journey.plan || section === "plan"))
    add(
      {
        id: "plan",
        kind: "plan",
        label: latest?.stale
          ? "Update the plan after changes"
          : `Find a plan within ${formatMoney(event.budgetMinor, event.currency)}`,
        prompt: `Find the lowest-cost valid shirt plan within ${formatMoney(event.budgetMinor, event.currency)}, keeping my current fixed choices.`,
      },
      8,
      ["plan"],
    );
  if (latest)
    add(
      {
        id: "explain",
        kind: "explain",
        label: latest.stale
          ? "What changed since this plan?"
          : latest.status === "optimal" || latest.status === "feasible"
            ? "Explain my shirt choices"
            : "Why isn't there a complete plan?",
        prompt: latest.stale
          ? "Explain the outdated plan and which current input changes need a new run."
          : "Explain the latest plan and anything still needing attention.",
      },
      6,
      ["plan"],
    );
  const locks = Object.keys(data.pipeline?.plannerLocks || {});
  if (locks.length && latest && !["optimal", "feasible"].includes(latest.status))
    add(
      {
        id: "unlock",
        kind: "unlock",
        label: `Reconsider ${locks.length === 1 ? data.teams.find((t) => t.id === locks[0])?.name + "'s fixed shirt" : `${locks.length} fixed shirts`}`,
        prompt:
          "Prepare to remove my saved fixed-shirt choices so the planner can consider the alternatives.",
      },
      7,
      ["plan"],
    );
  if (journey.confirmed && !journey.briefReady)
    add(
      {
        id: "brief",
        kind: "brief",
        label: "Prepare my seller's brief",
        prompt: "Prepare an order brief from my confirmed plan, without person previews.",
      },
      9,
      ["brief", "plan"],
    );
  return suggestions
    .filter(
      (s) =>
        s.id !== "next" ||
        !suggestions.some((other) => other.kind === "brief" || other.kind === "plan"),
    )
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 4)
    .map(({ priority, ...suggestion }) => suggestion);
}

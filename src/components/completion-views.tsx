"use client";
import { useState, type FormEvent } from "react";
import type { Workspace } from "@/server/workspace";
import type { AssistantDraft } from "@/server/assistant";
import { formatMoney, quoteOption } from "@/domain/validation";

type Props = { data: Workspace; onData: (data: Workspace) => void };
export function ChoiceConsequences({
  data,
  selection,
}: {
  data: Workspace;
  selection: Record<string, string>;
}) {
  const lines = data.teams.map((team) => {
    const option = data.options.find((o) => o.id === selection[team.id] && o.teamId === team.id);
    return { team, option, quote: option ? quoteOption(option, team.quantities) : null };
  });
  return (
    <section className="plan-result" aria-label="Consequences of current choices">
      <h3>What these choices mean across the event</h3>
      <p className="small-copy">
        Changing a team affects every fixture involving it. These checks use saved evidence; no new
        render is generated.
      </p>
      <strong>
        {formatMoney(
          lines.reduce((n, l) => n + (l.quote?.totalMinor || 0), 0),
          data.event!.currency,
        )}{" "}
        recorded cost / {formatMoney(data.event!.budgetMinor, data.event!.currency)} budget
      </strong>
      {lines
        .filter((l) => !l.option || !l.quote?.eligible || l.quote.minimumOrderNeedsSizes)
        .map((l) => (
          <p className="error-message" key={l.team.id}>
            {l.team.name}: check its option, stock or minimum-order size allocation.
          </p>
        ))}
      {data.fixtures.map((f) => {
        const a = data.options.find((o) => o.id === selection[f.teamA]),
          b = data.options.find((o) => o.id === selection[f.teamB]);
        const review = data.pipeline!.reviews.find(
          (r) => r.fixtureId === f.id && r.optionA === a?.id && r.optionB === b?.id && r.current,
        );
        return (
          <article key={f.id} className="consequence-row">
            <strong>{f.label}</strong>
            <span>
              {data.designs.find((d) => d.id === a?.designId)?.name || "Choose first shirt"} vs{" "}
              {data.designs.find((d) => d.id === b?.designId)?.name || "Choose opposing shirt"}
            </span>
            <span className="status-tag">{review ? review.status : "Review needed"}</span>
            {review && <small>{review.reason}</small>}
          </article>
        );
      })}
    </section>
  );
}
export function OrderBriefView({ data, onData }: Props) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmationId, setConfirmationId] = useState(""),
    [include, setInclude] = useState(false);
  const pipeline = data.pipeline!;
  const current = pipeline.confirmations.filter((c) =>
    pipeline.plans.some((p) => p.id === c.planId && !p.stale),
  );
  const selected = current.find((c) => c.id === confirmationId) || current.at(-1);
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "createBrief",
          eventId: data.event!.id,
          revision: data.event!.revision,
          confirmationId: selected.id,
          includePlayerPhotos: include,
        }),
      });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      onData(value);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create the brief.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pipeline-workspace">
      <section className="plan-result">
        <h2>Create a frozen order brief</h2>
        <p>
          Confirm a complete plan in Tournament Plan first. The brief preserves its designs,
          quantities, costs and review notes. It does not place an order.
        </p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {selected ? (
          <form onSubmit={create} className="completion-form">
            <label className="field">
              <span>Confirmed plan</span>
              <select value={selected.id} onChange={(e) => setConfirmationId(e.target.value)}>
                {current.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.createdAt} · {c.reviewer}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={include}
                onChange={(e) => setInclude(e.target.checked)}
              />
              Include generated person previews in this brief
            </label>
            <p className="small-copy">
              Original garment references are included. Person previews are excluded unless you
              select this option.
            </p>
            <button className="button" disabled={busy}>
              {busy ? "Freezing brief…" : "Create order brief"}
            </button>
          </form>
        ) : (
          <p>
            No current confirmed plan yet. Open Tournament Plan, run planning and confirm the
            result.
          </p>
        )}
      </section>
      <section className="plan-result">
        <h2>Saved order briefs</h2>
        {!pipeline.briefs.length && <p>No briefs created yet.</p>}
        {pipeline.briefs.map((b) => {
          const base = `/api/brief?event=${encodeURIComponent(data.event!.id)}&id=${encodeURIComponent(b.id)}`;
          const stale = pipeline.plans.find((p) => p.id === b.planId)?.stale;
          return (
            <article className="consequence-row" key={b.id}>
              <strong>
                {b.createdAt}
                {stale ? " · historical inputs" : ""}
              </strong>
              <span>{b.includePlayerPhotos ? "Includes person previews" : "No player photos"}</span>
              <div className="button-row">
                <a className="button secondary" target="_blank" rel="noreferrer" href={base}>
                  Open printable brief / PDF
                </a>
                <a className="button secondary" href={`${base}&format=csv`}>
                  Download CSV
                </a>
                <a className="button secondary" href={`${base}&format=json`}>
                  Download JSON
                </a>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
export function TextAssistantView({ data, onData }: Props) {
  const [text, setText] = useState(""),
    [explanation, setExplanation] = useState<{ id: string; text: string }[]>([]),
    [consent, setConsent] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<{ id: string; revision: number; payload: AssistantDraft } | null>(
      null,
    );
  async function request(op: "draft" | "apply" | "explain") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          op !== "apply"
            ? {
                op,
                eventId: data.event!.id,
                revision: data.event!.revision,
                text: text || "Explain the latest plan and its limits.",
                consent,
              }
            : {
                op,
                eventId: data.event!.id,
                revision: draft!.revision,
                draftId: draft!.id,
                confirmed,
              },
        ),
      });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      if (op === "explain") {
        setExplanation(value.facts);
      } else if (op === "draft") {
        setDraft(value);
        setConfirmed(false);
      } else {
        onData(value);
        setDraft(null);
        setText("");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "The helper could not finish.");
    } finally {
      setBusy(false);
    }
  }
  const teamName = (id: string) => data.teams.find((t) => t.id === id)?.name || id;
  return (
    <section className="plan-result">
      <h2>Turn written instructions into a draft</h2>
      <p>
        Ask for a specific budget, fixtures, or a particular shirt to lock. Nemotron via OpenRouter
        proposes edits; you review them before anything changes. Normal forms always remain
        available.
      </p>
      <p className="form-note">
        This sends your instruction, saved team names/codes and assigned shirt names to OpenRouter.
        No photos, reviewer notes, file paths or credentials are included. Avoid private personal
        details in your instruction. Plan explanations also send the saved choices, costs, fixture
        labels and planner facts.
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <label className="field">
        <span>Your instruction</span>
        <textarea
          value={text}
          maxLength={4000}
          rows={5}
          onChange={(e) => setText(e.target.value)}
          placeholder="Set the total budget to 300.50. Add Arsenal vs Liverpool."
        />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        Send this text and the listed catalog information to Nemotron via OpenRouter
      </label>
      <button
        className="button"
        disabled={busy || !consent || !text.trim()}
        onClick={() => void request("draft")}
      >
        {busy ? "Working…" : "Prepare draft"}
      </button>
      <button
        className="button secondary"
        disabled={busy || !consent || !data.pipeline!.plans.length}
        onClick={() => void request("explain")}
      >
        Explain latest plan using saved facts
      </button>
      {explanation.length > 0 && (
        <div className="review-history">
          <h3>Explanation grounded in this run</h3>
          {explanation.map((f) => (
            <p key={f.id}>{f.text}</p>
          ))}
        </div>
      )}
      {draft && (
        <div className="review-history">
          <h3>Review proposed changes</h3>
          {draft.payload.questions.length ? (
            <ul>
              {draft.payload.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          ) : (
            <>
              <ul>
                {draft.payload.budgetMinor !== null && (
                  <li>
                    Total budget → {formatMoney(draft.payload.budgetMinor, data.event!.currency)}
                  </li>
                )}
                {draft.payload.locks.map((l) => (
                  <li key={l.teamId}>
                    Lock {teamName(l.teamId)} to{" "}
                    {
                      data.designs.find(
                        (d) => d.id === data.options.find((o) => o.id === l.optionId)?.designId,
                      )?.name
                    }
                  </li>
                ))}
                {draft.payload.fixtures.map((f, i) => (
                  <li key={i}>
                    Add {f.label}: {teamName(f.teamA)} vs {teamName(f.teamB)}
                  </li>
                ))}
              </ul>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I checked these exact changes
              </label>
              <button
                className="button"
                disabled={busy || !confirmed || data.event!.revision !== draft.revision}
                onClick={() => void request("apply")}
              >
                Apply reviewed draft
              </button>
              {data.event!.revision !== draft.revision && (
                <p>The event changed. Prepare a fresh draft before applying.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
export function DataRecoveryView({ pending = 0 }: { pending?: number }) {
  return (
    <section className="settings-panel">
      <span className="eyebrow">PRIVACY AND RECOVERY</span>
      <h2>Your local files and backups</h2>
      {pending > 0 && (
        <p role="status" className="error-message">
          {pending} local file removals are waiting for retry. The images are already blocked from
          the app; the worker retries physical cleanup.
        </p>
      )}
      <p>
        Person and garment photos go to YouCam only when you explicitly queue a preview. Local
        deletion removes associated outputs and invalidates reviews; it does not request deletion
        from YouCam's systems. See{" "}
        <a href="https://www.perfectcorp.com/business/privacy" target="_blank" rel="noreferrer">
          the provider privacy policy
        </a>{" "}
        for provider handling.
      </p>
      <p>
        Use Preview Studio's local photo deletion controls. Saved briefs stop showing locally
        deleted images, while their order values remain frozen.
      </p>
      <p>
        Back up the database and all currently referenced private photos from a terminal in this
        repository:
      </p>
      <pre>npm run data:backup</pre>
      <p>Restore a verified backup into a new directory; existing work is never overwritten:</p>
      <pre>
        npm run data:restore -- --from ".local/backups/BACKUP-NAME" --to ".local/restored-workspace"
      </pre>
      <p>
        Stop the app and worker, set MATCHCLEAR_DATA_DIR to the restored folder in .env.local, then
        restart them. Restored jobs are held for attention and never automatically submitted.
        Backups contain private photos; store and delete backup copies separately.
      </p>
    </section>
  );
}

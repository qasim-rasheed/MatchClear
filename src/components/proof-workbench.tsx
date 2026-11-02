"use client";
import { useState } from "react";
import { showcaseInput, showcaseStages, inspectSelection } from "@/lib/planner/showcase";
import { solve } from "@/lib/planner/solve";
import { formatMoney } from "@/domain/validation";
import { Shirt } from "./shirt";

const colours: Record<string, string> = { r: "#a33b3b", g: "#416b53", n: "#283e56", w: "#e7e5db" };
export function ProofWorkbench() {
  const [stage, setStage] = useState(0),
    [locked, setLocked] = useState(false);
  const input = showcaseInput(),
    stages = showcaseStages();
  const result = solve({ ...input, locks: locked ? { D: "Dw" } : {} });
  const selection = stage === 2 && result.selection ? result.selection : stages[stage].selection;
  const inspected = inspectSelection(input, selection);
  const blocked = stage === 2 && !result.selection;
  return (
    <section className="proof-case" aria-labelledby="case-title">
      <div className="proof-section-heading">
        <div>
          <span className="eyebrow">01 / THE TOURNAMENT DECISION</span>
          <h2 id="case-title">One change can affect the next match.</h2>
        </div>
        <span className="proof-label">Synthetic planning example</span>
      </div>
      <p className="proof-intro">
        Four teams. Three fixtures. Twelve shirts per team. The decisions below are supplied test
        records, not findings about these illustrated colours.
      </p>
      <div className="proof-stages" aria-label="Planning example stages">
        {stages.map((s, i) => (
          <button
            key={s.title}
            className={stage === i ? "selected" : ""}
            aria-pressed={stage === i}
            onClick={() => setStage(i)}
          >
            <span>0{i + 1}</span>
            {s.title}
          </button>
        ))}
      </div>
      <div className="proof-case-body" aria-live="polite">
        <div className="proof-scoreline">
          <div>
            <span>Recorded order cost</span>
            <strong>{blocked ? "No valid plan" : formatMoney(inspected.costMinor, "EUR")}</strong>
          </div>
          <div>
            <span>Event budget</span>
            <strong>€300.00</strong>
          </div>
          <div>
            <span>Unresolved fixtures</span>
            <strong>
              {blocked ? "—" : inspected.fixtures.filter((f) => f.status !== "approved").length}
            </strong>
          </div>
        </div>
        {blocked ? (
          <p className="form-note">
            Keeping Old Town in white makes the supplied constraints impossible within €300. Unlock
            its owned navy spare to restore the €216 solution. With white fixed, the cheapest
            supplied valid selection costs €444.
          </p>
        ) : (
          <>
            <div className="proof-teams">
              {input.teams.map((t) => {
                const c = input.candidates.find((c) => c.id === selection[t.id])!;
                return (
                  <article key={t.id}>
                    <Shirt
                      primary={colours[c.id[1]]}
                      secondary="#eee9da"
                      label={`${t.name}: ${c.label}, illustration`}
                    />
                    <strong>{t.name}</strong>
                    <span>{c.label}</span>
                    <small>
                      {c.costMinor
                        ? `${formatMoney(c.costMinor, "EUR")} / 12 shirts`
                        : "Already owned · €0"}
                    </small>
                  </article>
                );
              })}
            </div>
            <div className="proof-fixtures">
              {inspected.fixtures.map((f) => (
                <div key={f.id}>
                  <span>{f.label}</span>
                  <strong className={f.status === "approved" ? "proof-approved" : "proof-rejected"}>
                    {f.status === "approved" ? "✓ Supplied approval" : "× Supplied rejection"}
                  </strong>
                </div>
              ))}
            </div>
            <p className="proof-explanation">{stages[stage].detail}</p>
          </>
        )}
      </div>
      <label className="checkbox proof-lock">
        <input
          type="checkbox"
          checked={locked}
          onChange={(e) => {
            setLocked(e.target.checked);
            setStage(2);
          }}
        />
        Keep Old Town's white shirt fixed and recompute
      </label>
      <details>
        <summary>Where do the €216 and €444 figures come from?</summary>
        <p>
          Buying white for Northbank costs 12 × €18 = €216; Old Town switches to its owned navy
          spare. Following the local navy purchase with Riverside's white replacement costs 12 × €12
          + 12 × €25 = €444. These are illustrative prices and complete supplied pair decisions. The
          application runs the same planner used by real events, without writing any approvals or
          consuming API units here.
        </p>
      </details>
    </section>
  );
}

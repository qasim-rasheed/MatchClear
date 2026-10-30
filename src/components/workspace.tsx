"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Workspace } from "@/server/workspace";
import {
  formatMoney,
  moneyToMinor,
  quoteOption,
  sizeKeys,
  totalQuantity,
} from "@/domain/validation";
import { Shirt } from "./shirt";
import { CsvImport } from "./csv-import";

type Tab = "overview" | "teams" | "fixtures" | "shirts" | "settings";
type Team = Workspace["teams"][number];
type Design = Workspace["designs"][number];
type Option = Workspace["options"][number];
type Editor = {
  kind: "event" | "team" | "fixture" | "design" | "option" | "help";
  item?: Team | Design | Option;
  create?: boolean;
};
const labels: Record<Tab, string> = {
  overview: "Overview",
  teams: "Teams",
  fixtures: "Fixtures",
  shirts: "Shirt library",
  settings: "Workspace settings",
};
const steps = ["Set up event", "Preview shirts", "Review matchups", "Choose a plan"];

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    teams: (
      <>
        <circle cx="8" cy="7" r="3" />
        <circle cx="17" cy="8" r="2.5" />
        <path d="M2 20v-3a6 6 0 0 1 12 0v3M15 14a5 5 0 0 1 7 5v1" />
      </>
    ),
    fixtures: (
      <>
        <path d="M5 4v16M19 4v16M2 8h6M16 16h6M9 8h3a4 4 0 0 1 0 8H9" />
      </>
    ),
    shirts: <path d="m8 4-3 1-4 5 4 3 2-2v10h10V11l2 2 4-3-4-5-3-1c-2 3-6 3-8 0Z" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || <path d="M5 12h14m-6-6 6 6-6 6" />}
    </svg>
  );
}

export function WorkspaceApp({ initial }: { initial: Workspace }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>("overview");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const [csvImport, setCsvImport] = useState<"teams" | "fixtures" | null>(null);
  const event = data.event;
  const currency = event?.currency || "EUR";
  const count = data.teams.reduce((n, t) => n + totalQuantity(t.quantities), 0);
  async function refresh(eventId?: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspace${eventId ? `?event=${encodeURIComponent(eventId)}` : ""}`,
        { cache: "no-store" },
      );
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setData(value);
      window.history.replaceState(
        null,
        "",
        value.event ? `/?event=${encodeURIComponent(value.event.id)}` : "/",
      );
      setNotice("Latest saved version loaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the event.");
    } finally {
      setBusy(false);
    }
  }
  async function mutate(op: string, input?: unknown, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op,
          eventId: event?.id,
          revision: event?.revision,
          input,
          ...extra,
        }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setData(value);
      window.history.replaceState(
        null,
        "",
        value.event ? `/?event=${encodeURIComponent(value.event.id)}` : "/",
      );
      setEditor(null);
      setNotice("Changes saved to this workspace.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function open(value: Editor) {
    setError("");
    setEditor(value);
  }
  const teamName = (id: string) => data.teams.find((t) => t.id === id)?.name || "Team unavailable";
  const readiness = [
    data.teams.length > 1,
    data.fixtures.length > 0,
    data.teams.length > 0 && data.teams.every((t) => data.options.some((o) => o.teamId === t.id)),
    false,
  ];

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="MatchClear home">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          MatchClear<span className="brand-dot">.</span>
        </a>
        <div className="sidebar-label">TOURNAMENT WORKSPACE</div>
        <label className="event-switch">
          <span className="sr-only">Choose event</span>
          <select
            value={event?.id || ""}
            onChange={(e) => {
              void refresh(e.target.value);
            }}
            disabled={busy || !data.events.length}
          >
            {!data.events.length && <option value="">No active events</option>}
            {data.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Workspace">
          {(["overview", "teams", "fixtures", "shirts"] as Tab[]).map((key) => (
            <button
              key={key}
              className={`nav-item ${tab === key ? "active" : ""}`}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                setTab(key);
                setFilter("");
              }}
            >
              <Icon name={key} />
              {labels[key]}
              {key === "teams" && <span>{data.teams.length}</span>}
              {key === "fixtures" && <span>{data.fixtures.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-guide">
          <span className="eyebrow">THE NEXT STEP</span>
          <h3>
            Start with the shirts
            <br />
            you already have.
          </h3>
          <p>Add owned shirts alongside new options to keep the order practical.</p>
          <button className="text-button" onClick={() => setTab("shirts")}>
            Open shirt library <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            <Icon name="settings" />
            Workspace settings
          </button>
          <button className="nav-item" onClick={() => open({ kind: "help" })}>
            <span className="help-icon">?</span>About this baseline
          </button>
          <div className="local-status">
            <span />
            Local workspace <small>Saved on this computer</small>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{labels[tab]}</strong>
          </div>
          <div className="topbar-actions">
            {(tab === "teams" || tab === "fixtures") && (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setCsvImport(tab as "teams" | "fixtures");
                }}
              >
                Import CSV
              </button>
            )}
            <span className="save-indicator">
              {busy ? "Saving / loading…" : "Local storage connected"}
            </span>
            <button className="button small" onClick={() => open({ kind: "event", create: true })}>
              ＋ New event
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button aria-label="Dismiss notification" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
          {error && !editor && (
            <div className="error-message" role="alert">
              {error}
              <button className="text-button" onClick={() => void refresh(event?.id)}>
                Refresh saved data
              </button>
            </div>
          )}
          {!event ? (
            <section className="empty-page">
              <span className="eyebrow">YOUR NEXT TOURNAMENT</span>
              <h1>A clear starting point.</h1>
              <p>Create an event to add teams, fixtures and shirt options.</p>
              <button className="button" onClick={() => open({ kind: "event", create: true })}>
                Create an event
              </button>
            </section>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {event.sample ? "ILLUSTRATIVE STARTER EVENT" : "YOUR EVENT"}
                    <span className="dot-separator">·</span>ONE SHIRT PER TEAM
                  </div>
                  <h1>{tab === "overview" ? event.name : labels[tab]}</h1>
                  <p>
                    {tab === "overview"
                      ? "Bring the teams, shirts and matchups together before you order."
                      : tab === "teams"
                        ? "Set the roster and shirt quantities for each team."
                        : tab === "fixtures"
                          ? "Record who plays whom. Every opposing pair will need a review."
                          : tab === "shirts"
                            ? "Keep owned shirts and new options in the same place."
                            : "Manage event details, local data and integration readiness."}
                  </p>
                </div>
                <button className="button secondary" onClick={() => open({ kind: "event" })}>
                  Edit event <span aria-hidden="true">↗</span>
                </button>
              </div>
              {tab === "overview" && (
                <>
                  <div className="journey" aria-label="Project workflow">
                    {steps.map((step, i) => (
                      <div key={step} className={i === 0 ? "current" : ""}>
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        {step}
                        {i > 0 && <small>Coming next</small>}
                      </div>
                    ))}
                  </div>
                  <section className="summary-strip" aria-label="Event summary">
                    <Summary value={String(data.teams.length).padStart(2, "0")} label="Teams" />
                    <Summary value={String(count)} label="Shirts needed" />
                    <Summary
                      value={String(data.fixtures.length).padStart(2, "0")}
                      label="Scheduled matches"
                    />
                    <Summary
                      value={formatMoney(event.budgetMinor, currency)}
                      label="Order budget"
                    />
                  </section>
                  <div className="overview-grid">
                    <section>
                      <SectionTitle
                        title="The teams"
                        subtitle="Shirt options, side by side."
                        action="Manage teams"
                        onClick={() => setTab("teams")}
                      />
                      <div className="team-grid">
                        {data.teams.map((t, i) => (
                          <TeamCard
                            key={t.id}
                            team={t}
                            index={i}
                            designs={data.designs}
                            options={data.options}
                            onEdit={() => open({ kind: "team", item: t })}
                          />
                        ))}
                        {!data.teams.length && (
                          <Empty
                            text="Add your first team to start building the event."
                            action="Add team"
                            onClick={() => open({ kind: "team" })}
                          />
                        )}
                      </div>
                      <SectionTitle
                        title="On the fixture list"
                        subtitle="Reviews will be recorded against each opposing pair."
                        action="All fixtures"
                        onClick={() => setTab("fixtures")}
                      />
                      <FixtureList data={data} teamName={teamName} />
                    </section>
                    <aside className="right-column">
                      <section className="setup-panel">
                        <span className="eyebrow">EVENT READINESS</span>
                        <h2>
                          A good plan starts
                          <br />
                          with good inputs.
                        </h2>
                        <ol>
                          {[
                            "Add at least two teams",
                            "Enter the opposing pairs",
                            "Assign shirt options",
                            "Add real preview evidence",
                          ].map((text, i) => (
                            <li key={text}>
                              <span className={`check ${readiness[i] ? "done" : ""}`}>
                                {readiness[i] ? "✓" : i + 1}
                              </span>
                              <div>
                                {text}
                                <small>
                                  {readiness[i]
                                    ? "Ready"
                                    : i === 3
                                      ? "Live feasibility test first"
                                      : "Needs your input"}
                                </small>
                              </div>
                            </li>
                          ))}
                        </ol>
                        <button
                          className="button full"
                          onClick={() =>
                            open({
                              kind:
                                data.teams.length < 2
                                  ? "team"
                                  : data.fixtures.length
                                    ? "option"
                                    : "fixture",
                            })
                          }
                        >
                          Continue event setup <span aria-hidden="true">→</span>
                        </button>
                      </section>
                      <section className="evidence-note">
                        <span className="outline-symbol">i</span>
                        <h3>Examples, clearly marked.</h3>
                        <p>
                          {event.sample
                            ? "This starter uses fictional teams, original shirt illustrations and illustrative prices. No visual combinations have been approved."
                            : "Your records are saved locally. Catalog illustrations need real photographic references before a preview can support matchup review."}
                        </p>
                        <button className="text-button" onClick={() => open({ kind: "help" })}>
                          What this version includes ↗
                        </button>
                      </section>
                    </aside>
                  </div>
                </>
              )}
              {tab === "teams" && (
                <>
                  <SectionTitle
                    title={`${data.teams.length} teams in this event`}
                    subtitle={`${count} shirts requested across the roster.`}
                    action="＋ Add team"
                    onClick={() => open({ kind: "team" })}
                  />
                  <div className="team-grid wide">
                    {data.teams.map((t, i) => (
                      <TeamCard
                        key={t.id}
                        team={t}
                        index={i}
                        designs={data.designs}
                        options={data.options}
                        onEdit={() => open({ kind: "team", item: t })}
                      />
                    ))}
                    {!data.teams.length && (
                      <Empty
                        text="Your team list is empty."
                        action="Add a team"
                        onClick={() => open({ kind: "team" })}
                      />
                    )}
                  </div>
                </>
              )}
              {tab === "fixtures" && (
                <>
                  <SectionTitle
                    title="Scheduled opposing pairs"
                    subtitle="One entry per opposing pair in fixed-shirt mode."
                    action="＋ Add fixture"
                    onClick={() => open({ kind: "fixture" })}
                  />
                  <FixtureList
                    data={data}
                    teamName={teamName}
                    onRemove={(id) => void mutate("removeFixture", undefined, { fixtureId: id })}
                    busy={busy}
                  />
                </>
              )}
              {tab === "shirts" && (
                <>
                  <div className="library-toolbar">
                    <label className="search-field">
                      <span aria-hidden="true">⌕</span>
                      <input
                        aria-label="Search shirt designs"
                        placeholder="Find a shirt or colour…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      />
                    </label>
                    <div>
                      <button className="button secondary" onClick={() => open({ kind: "option" })}>
                        Assign shirt to team
                      </button>
                      <button className="button" onClick={() => open({ kind: "design" })}>
                        ＋ Add design
                      </button>
                    </div>
                  </div>
                  <div className="library-grid">
                    {data.designs
                      .filter((d) =>
                        `${d.name} ${d.colour}`.toLowerCase().includes(filter.toLowerCase()),
                      )
                      .map((d) => (
                        <article className="shirt-card" key={d.id}>
                          <div className="shirt-stage">
                            <span className="stage-label">ILLUSTRATION</span>
                            <Shirt
                              primary={d.primaryHex}
                              secondary={d.secondaryHex}
                              pattern={d.pattern}
                              label={`${d.colour} ${d.pattern} shirt illustration`}
                            />
                            <span className="design-number">
                              REF {d.id.slice(0, 5).toUpperCase()}
                            </span>
                          </div>
                          <div className="shirt-details">
                            <div>
                              <h3>{d.name}</h3>
                              <p>
                                {d.colour} · {d.pattern}
                              </p>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={`Edit ${d.name}`}
                              onClick={() => open({ kind: "design", item: d })}
                            >
                              ↗
                            </button>
                          </div>
                          <div className="option-list">
                            {data.options
                              .filter((o) => o.designId === d.id)
                              .map((o) => {
                                const team = data.teams.find((t) => t.id === o.teamId)!;
                                const quote = quoteOption(o, team.quantities);
                                return (
                                  <button
                                    key={o.id}
                                    className="option-row"
                                    onClick={() => open({ kind: "option", item: o })}
                                  >
                                    <span>
                                      {team.code}{" "}
                                      <small>
                                        {o.owned
                                          ? "Owned"
                                          : `${formatMoney(o.unitMinor, currency)} / shirt`}
                                      </small>
                                    </span>
                                    <strong>
                                      {!o.available
                                        ? "Unavailable"
                                        : quote.minimumOrderNeedsSizes
                                          ? "Sizes needed for extras"
                                          : !quote.eligible
                                            ? "Check stock"
                                            : formatMoney(quote.totalMinor, currency)}{" "}
                                      <span aria-hidden="true">↗</span>
                                    </strong>
                                  </button>
                                );
                              })}
                            {!data.options.some((o) => o.designId === d.id) && (
                              <p className="muted">Not assigned to a team yet.</p>
                            )}
                          </div>
                        </article>
                      ))}
                  </div>
                  {!data.designs.length && (
                    <Empty
                      text="Add a design, then assign it to a team."
                      action="Add a design"
                      onClick={() => open({ kind: "design" })}
                    />
                  )}
                </>
              )}
              {tab === "settings" && (
                <div className="settings-grid">
                  <section className="settings-panel">
                    <span className="eyebrow">EVENT DETAILS</span>
                    <h2>{event.name}</h2>
                    <dl>
                      <dt>Order budget</dt>
                      <dd>{formatMoney(event.budgetMinor, currency)}</dd>
                      <dt>Event date</dt>
                      <dd>{event.eventDate || "Not set"}</dd>
                      <dt>Choice rule</dt>
                      <dd>One fixed shirt per team</dd>
                      <dt>Saved revision</dt>
                      <dd>{event.revision}</dd>
                      <dt>Data location</dt>
                      <dd>This computer · SQLite</dd>
                    </dl>
                    <button className="button secondary" onClick={() => open({ kind: "event" })}>
                      Edit event details
                    </button>
                  </section>
                  <section className="settings-panel">
                    <span className="eyebrow">YOUCAM CONNECTION</span>
                    <h2>
                      {data.integration.configured ? "Key configured." : "Key not configured."}
                    </h2>
                    <p>
                      {data.integration.configured
                        ? "The server can read a local key. The separate feasibility CLI records real render results; these are not yet linked to event reviews."
                        : "Add YOUCAM_API_KEY to your ignored .env.local file to prepare the feasibility test."}
                    </p>
                    <div className="status-tag">
                      {data.integration.liveValidated
                        ? "Live smoke test passed"
                        : "Live validation pending"}
                    </div>
                    <p className="small-copy">
                      The API test is run separately with permitted photos. This baseline does not
                      submit renders from the interface.
                    </p>
                  </section>
                  <section className="settings-panel full-span">
                    <span className="eyebrow">RECENT CHANGES</span>
                    <h2>Workspace history</h2>
                    <ul className="activity-list">
                      {data.activity.map((a) => (
                        <li key={a.id}>
                          <span>{activityLabel(a.action)}</span>
                          <time dateTime={a.createdAt}>
                            {new Date(a.createdAt).toLocaleString("en-GB")}
                          </time>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="settings-panel full-span">
                    <h3>Archive this event</h3>
                    <p>
                      Hide the event from the active list and keep its saved history. No photos or
                      records are deleted.
                    </p>
                    <button
                      className="button secondary danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(`Archive ${event.name}? Its saved records will be kept.`)
                        )
                          void mutate("archiveEvent");
                      }}
                    >
                      Archive event
                    </button>
                  </section>
                </div>
              )}
              <footer className="workspace-footer">
                <span>MatchClear / Organizer workspace</span>
                <span>
                  Appearance review supports a decision. It does not certify physical kit
                  visibility.
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {csvImport && (
        <CsvImport
          kind={csvImport}
          externalError={error}
          onClose={() => setCsvImport(null)}
          onImport={mutate}
        />
      )}
      {editor && (
        <EditorModal
          editor={editor}
          data={data}
          busy={busy}
          error={error}
          onClose={() => {
            setEditor(null);
            setError("");
          }}
          onSubmit={mutate}
          onError={setError}
        />
      )}
    </div>
  );
}

function Summary({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function SectionTitle({
  title,
  subtitle,
  action,
  onClick,
}: {
  title: string;
  subtitle: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <button className="text-button" onClick={onClick}>
        {action} <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
function Empty({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return (
    <div className="empty-state">
      <p>{text}</p>
      <button className="button secondary" onClick={onClick}>
        {action}
      </button>
    </div>
  );
}
function TeamCard({
  team,
  index,
  designs,
  options,
  onEdit,
}: {
  team: Team;
  index: number;
  designs: Design[];
  options: Option[];
  onEdit: () => void;
}) {
  const assigned = options.filter((o) => o.teamId === team.id);
  return (
    <article className="team-card">
      <div className="team-card-top">
        <span className="team-code">{team.code}</span>
        <span className="tiny-label">TEAM {String(index + 1).padStart(2, "0")}</span>
        <button className="icon-button" aria-label={`Edit ${team.name}`} onClick={onEdit}>
          ↗
        </button>
      </div>
      <h3>{team.name}</h3>
      <p>
        {totalQuantity(team.quantities)} shirts needed <span>·</span> {assigned.length} options
      </p>
      <div className="mini-shirt-row">
        {assigned.slice(0, 2).map((o) => {
          const d = designs.find((d) => d.id === o.designId)!;
          return (
            <div key={o.id}>
              <Shirt
                primary={d.primaryHex}
                secondary={d.secondaryHex}
                pattern={d.pattern}
                label={`${d.colour} illustration`}
              />
              <span>{o.owned ? "Owned" : "New option"}</span>
            </div>
          );
        })}
        {!assigned.length && <div className="no-shirt">No shirt options assigned</div>}
      </div>
      <div className="team-card-bottom">
        <span className="status-tag">Preview needed</span>
        <span>
          {sizeKeys
            .filter((s) => team.quantities[s])
            .map((s) => `${s} ${team.quantities[s]}`)
            .join(" / ")}
        </span>
      </div>
    </article>
  );
}
function FixtureList({
  data,
  teamName,
  onRemove,
  busy,
}: {
  data: Workspace;
  teamName: (id: string) => string;
  onRemove?: (id: string) => void;
  busy?: boolean;
}) {
  return (
    <div className="fixture-list">
      {!data.fixtures.length && (
        <p className="empty-state">No opposing pairs yet. Add a fixture to continue.</p>
      )}
      {data.fixtures.map((f, i) => (
        <div className="fixture-row" key={f.id}>
          <span className="fixture-index">{String(i + 1).padStart(2, "0")}</span>
          <div className="fixture-teams">
            <strong>{teamName(f.teamA)}</strong>
            <span>vs</span>
            <strong>{teamName(f.teamB)}</strong>
          </div>
          <span className="fixture-label">{f.label}</span>
          <span className="status-tag">Not reviewed</span>
          {onRemove && (
            <button
              className="icon-button"
              disabled={busy}
              aria-label={`Remove ${f.label}`}
              onClick={() => onRemove(f.id)}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
function activityLabel(value: string) {
  return (
    (
      {
        "sample.created": "Illustrative starter event created",
        createEvent: "Event created",
        updateEvent: "Event settings updated",
        importTeams: "Teams imported from reviewed CSV",
        importFixtures: "Fixtures imported from reviewed CSV",
        addTeam: "Team added",
        updateTeam: "Team quantities or details updated",
        addFixture: "Fixture added",
        removeFixture: "Fixture removed",
        addDesign: "Shirt design added",
        updateDesign: "Shirt design changed; visual evidence invalidated",
        addOption: "Shirt assigned to a team",
        updateOption: "Price or availability updated",
      } as Record<string, string>
    )[value] || value
  );
}

function EditorModal({
  editor,
  data,
  busy,
  error,
  onClose,
  onSubmit,
  onError,
}: {
  editor: Editor;
  data: Workspace;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (op: string, input?: unknown, extra?: Record<string, unknown>) => Promise<boolean>;
  onError: (value: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const team = editor.kind === "team" ? (editor.item as Team | undefined) : undefined;
  const design = editor.kind === "design" ? (editor.item as Design | undefined) : undefined;
  const option = editor.kind === "option" ? (editor.item as Option | undefined) : undefined;
  const event = data.event;
  const titles = {
    event: editor.create ? "Create a tournament" : "Edit event details",
    team: team ? "Edit team" : "Add a team",
    fixture: "Add an opposing pair",
    design: design ? "Edit shirt design" : "Add a shirt design",
    option: option ? "Edit price and availability" : "Assign a shirt option",
    help: "The MatchClear baseline",
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const str = (name: string) => String(form.get(name) ?? "");
    const num = (name: string) => Number(str(name));
    const quantities = (prefix: string) =>
      Object.fromEntries(sizeKeys.map((s) => [s, num(`${prefix}${s}`)]));
    try {
      if (editor.kind === "event")
        await onSubmit(editor.create ? "createEvent" : "updateEvent", {
          name: str("name"),
          currency: str("currency"),
          budgetMinor: moneyToMinor(str("budget")),
          eventDate: str("date"),
        });
      if (editor.kind === "team")
        await onSubmit(
          team ? "updateTeam" : "addTeam",
          { name: str("name"), code: str("code"), quantities: quantities("size-") },
          team ? { teamId: team.id } : {},
        );
      if (editor.kind === "fixture")
        await onSubmit("addFixture", {
          teamA: str("teamA"),
          teamB: str("teamB"),
          label: str("label"),
        });
      if (editor.kind === "design")
        await onSubmit(
          design ? "updateDesign" : "addDesign",
          {
            name: str("name"),
            colour: str("colour"),
            primaryHex: str("primary"),
            secondaryHex: str("secondary"),
            pattern: str("pattern"),
          },
          design ? { designId: design.id } : {},
        );
      if (editor.kind === "option") {
        const input = {
          unitMinor: moneyToMinor(str("unit")),
          setupMinor: moneyToMinor(str("setup")),
          minimumOrder: num("minimum"),
          stock: quantities("stock-"),
          available: form.has("available"),
          seller: str("seller"),
          priceDate: str("priceDate"),
        };
        await onSubmit(
          option ? "updateOption" : "addOption",
          option
            ? input
            : {
                ...input,
                teamId: str("teamId"),
                designId: str("designId"),
                owned: form.has("owned"),
              },
          option ? { optionId: option.id } : {},
        );
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Check the form and try again.");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="editor-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <span className="eyebrow">MATCHCLEAR WORKSPACE</span>
          <h2 id="editor-title">{titles[editor.kind]}</h2>
        </div>
        <button className="icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}>
          ×
        </button>
      </div>
      {editor.kind === "help" ? (
        <div className="help-copy">
          <p>
            This version saves event details, teams, fixtures, shirt illustrations and
            price/availability records on this computer.
          </p>
          <p>
            YouCam feasibility tools and the review data model are prepared. Preview generation,
            visual screening, tournament optimization and order exports are later steps.
          </p>
          <p>
            The starter event contains no real participants or retailer offers. Shirt drawings are
            original illustrations, not YouCam results or photographic references.
          </p>
          <button className="button" onClick={onClose}>
            Back to workspace
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="modal-fields">
            {editor.kind === "event" && (
              <>
                <Field label="Event name">
                  <input
                    name="name"
                    minLength={2}
                    maxLength={80}
                    required
                    defaultValue={editor.create ? "" : event?.name}
                    placeholder="e.g. Saturday Community Cup"
                    autoFocus
                  />
                </Field>
                <div className="form-row">
                  <Field label="Currency">
                    <select name="currency" defaultValue={editor.create ? "EUR" : event?.currency}>
                      {["EUR", "GBP", "USD"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Total order budget">
                    <input
                      name="budget"
                      inputMode="decimal"
                      required
                      pattern="[0-9]+(\.[0-9]{1,2})?"
                      defaultValue={
                        editor.create ? "500.00" : ((event?.budgetMinor || 0) / 100).toFixed(2)
                      }
                    />
                  </Field>
                </div>
                <Field label="Event date (optional)">
                  <input
                    name="date"
                    type="date"
                    defaultValue={editor.create ? "" : event?.eventDate || ""}
                  />
                </Field>
                <p className="form-note">
                  Each team keeps one shirt choice throughout this event. Currency is fixed once
                  shirt prices are entered.
                </p>
              </>
            )}
            {editor.kind === "team" && (
              <>
                <Field label="Team name">
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={team?.name}
                    autoFocus
                  />
                </Field>
                <Field label="Short code">
                  <input
                    name="code"
                    required
                    minLength={2}
                    maxLength={4}
                    pattern="[A-Za-z0-9]+"
                    defaultValue={team?.code}
                    placeholder="e.g. NFC"
                  />
                </Field>
                <fieldset>
                  <legend>Shirts needed by size</legend>
                  <Sizes
                    prefix="size-"
                    values={team?.quantities || { XS: 0, S: 3, M: 5, L: 4, XL: 0, XXL: 0 }}
                  />
                </fieldset>
                <p className="form-note">
                  These are requested quantities, not sizes inferred from a photo.
                </p>
              </>
            )}
            {editor.kind === "fixture" && (
              <>
                <Field label="Fixture label">
                  <input
                    name="label"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={`Match ${data.fixtures.length + 1}`}
                    autoFocus
                  />
                </Field>
                <Field label="First team">
                  <select name="teamA" required defaultValue={data.teams[0]?.id || ""}>
                    <option value="" disabled>
                      Choose team
                    </option>
                    {data.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Opposing team">
                  <select name="teamB" required defaultValue={data.teams[1]?.id || ""}>
                    <option value="" disabled>
                      Choose team
                    </option>
                    {data.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="form-note">
                  Both teams must belong to this event. Duplicate opposing pairs are kept out of the
                  list.
                </p>
              </>
            )}
            {editor.kind === "design" && (
              <>
                <Field label="Design name">
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={design?.name}
                    autoFocus
                  />
                </Field>
                <Field label="Colour description">
                  <input
                    name="colour"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={design?.colour}
                    placeholder="e.g. Navy with white panels"
                  />
                </Field>
                <div className="form-row">
                  <Field label="Main colour">
                    <input
                      type="color"
                      name="primary"
                      defaultValue={design?.primaryHex || "#283e56"}
                    />
                  </Field>
                  <Field label="Detail colour">
                    <input
                      type="color"
                      name="secondary"
                      defaultValue={design?.secondaryHex || "#e7e5db"}
                    />
                  </Field>
                </div>
                <Field label="Illustration pattern">
                  <select name="pattern" defaultValue={design?.pattern || "solid"}>
                    <option value="solid">Solid</option>
                    <option value="panel">Chest panel</option>
                    <option value="stripe">Vertical stripes</option>
                  </select>
                </Field>
                <p className="form-note">
                  This creates a catalog illustration. A real permitted garment photograph is still
                  required for a YouCam test.
                </p>
              </>
            )}
            {editor.kind === "option" && (
              <>
                {!option && (
                  <>
                    <Field label="Team">
                      <select name="teamId" required defaultValue={data.teams[0]?.id || ""}>
                        <option value="" disabled>
                          Choose team
                        </option>
                        {data.teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Shirt design">
                      <select name="designId" required defaultValue={data.designs[0]?.id || ""}>
                        <option value="" disabled>
                          Choose design
                        </option>
                        {data.designs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <label className="checkbox">
                      <input name="owned" type="checkbox" />
                      Already owned (purchase and setup costs must be zero)
                    </label>
                  </>
                )}
                <div className="form-row">
                  <Field label={`Price per shirt (${event?.currency})`}>
                    <input
                      name="unit"
                      required
                      inputMode="decimal"
                      defaultValue={((option?.unitMinor || 0) / 100).toFixed(2)}
                    />
                  </Field>
                  <Field label="Order setup charge">
                    <input
                      name="setup"
                      required
                      inputMode="decimal"
                      defaultValue={((option?.setupMinor || 0) / 100).toFixed(2)}
                    />
                  </Field>
                </div>
                <Field label="Minimum order quantity">
                  <input
                    type="number"
                    name="minimum"
                    required
                    min="0"
                    max="1000"
                    defaultValue={option?.minimumOrder || 0}
                  />
                </Field>
                <fieldset>
                  <legend>Available quantity by size</legend>
                  <Sizes
                    prefix="stock-"
                    values={option?.stock || { XS: 20, S: 20, M: 20, L: 20, XL: 20, XXL: 20 }}
                  />
                </fieldset>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="available"
                    defaultChecked={option?.available ?? true}
                  />
                  Available according to supplied information
                </label>
                <Field label="Source or seller reference">
                  <input
                    name="seller"
                    maxLength={120}
                    defaultValue={option?.seller || ""}
                    placeholder="Where this price and stock came from"
                  />
                </Field>
                <Field label="Information checked on">
                  <input
                    type="date"
                    name="priceDate"
                    defaultValue={option?.priceDate || new Date().toISOString().slice(0, 10)}
                  />
                </Field>
                <p className="form-note">
                  Manually supplied availability; no live retailer is connected. Extra units
                  required by an order minimum still need size allocation.
                </p>
              </>
            )}
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="button secondary" type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="button" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Sizes({ prefix, values }: { prefix: string; values: Record<string, number> }) {
  return (
    <div className="sizes">
      {sizeKeys.map((s) => (
        <Field key={s} label={s}>
          <input
            type="number"
            name={`${prefix}${s}`}
            min="0"
            max="1000"
            required
            defaultValue={values[s] || 0}
          />
        </Field>
      ))}
    </div>
  );
}

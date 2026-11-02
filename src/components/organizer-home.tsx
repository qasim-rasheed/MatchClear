"use client";
import type { Workspace } from "@/server/workspace";
import type { OrganizerSection } from "@/domain/assistant-agent";
import { organizerJourney } from "@/lib/organizer-journey";
import { formatMoney, totalQuantity } from "@/domain/validation";
import { Shirt } from "./shirt";
import { assetUrl } from "./pipeline-views";
type Props = {
  data: Workspace;
  onNavigate: (tab: OrganizerSection) => void;
  onContinue: () => void;
  onAsk: () => void;
};
export function OrganizerHome({ data, onNavigate, onContinue, onAsk }: Props) {
  const journey = organizerJourney(data),
    event = data.event!;
  return (
    <div className="organizer-home">
      <section className="next-decision" aria-labelledby="next-decision-title">
        <div>
          <span className="assistant-kicker">
            {journey.completed === 5 ? "READY FOR YOUR SELLER" : "YOUR NEXT STEP"}
          </span>
          <h2 id="next-decision-title">{journey.next.title}</h2>
          <p>{journey.next.body}</p>
          <div className="button-row">
            <button className="button" onClick={onContinue}>
              {journey.next.button} →
            </button>
            <button className="text-button" onClick={onAsk}>
              Help me with this
            </button>
          </div>
        </div>
        <div className="order-goal">
          <strong>{journey.shirts || "—"}</strong>
          <span>
            team shirts
            <br />
            one clear order
          </span>
        </div>
      </section>
      <section className="organizer-facts" aria-label="Tournament summary">
        <div>
          <strong>{data.teams.length}</strong>
          <span>Teams</span>
        </div>
        <div>
          <strong>{data.fixtures.length}</strong>
          <span>Matches</span>
        </div>
        <div>
          <strong>{formatMoney(event.budgetMinor, event.currency)}</strong>
          <span>Shirt budget</span>
        </div>
        <div>
          <strong>{journey.completed}/5</strong>
          <span>Stages complete</span>
        </div>
      </section>
      <section className="home-roster">
        <div className="section-title">
          <div>
            <h2>Your teams</h2>
            <p>Shirt choices and what still needs attention.</p>
          </div>
          <button className="text-button" onClick={() => onNavigate("teams")}>
            Manage teams →
          </button>
        </div>
        {data.teams.length ? (
          <div className="home-team-list">
            {data.teams.map((team) => {
              const option = data.options.find((o) => o.teamId === team.id),
                design = data.designs.find((d) => d.id === option?.designId);
              const accepted = data.pipeline?.previews.some(
                (p) => p.teamId === team.id && p.usable,
              );
              const photo =
                design?.assetId &&
                data.pipeline?.assets.some((a) => a.id === design.assetId && !a.deletedAt);
              return (
                <button
                  className="home-team-row"
                  key={team.id}
                  onClick={() => onNavigate(!option ? "shirts" : accepted ? "reviews" : "previews")}
                >
                  <span className="home-team-image">
                    {design ? (
                      photo ? (
                        <img
                          src={assetUrl(event.id, design.assetId!)}
                          alt={`${design.name} original shirt`}
                        />
                      ) : (
                        <Shirt
                          primary={design.primaryHex}
                          secondary={design.secondaryHex}
                          pattern={design.pattern}
                          label={`${design.name} illustration`}
                        />
                      )
                    ) : (
                      <span>{team.code}</span>
                    )}
                  </span>
                  <span className="home-team-name">
                    <strong>{team.name}</strong>
                    <small>
                      {totalQuantity(team.quantities)} shirts · {design?.name || "Choose a shirt"}
                    </small>
                  </span>
                  <span className={`home-team-state ${accepted ? "ready" : ""}`}>
                    {!option ? "Choose shirts" : accepted ? "Preview checked" : "Preview needed"}
                    <span aria-hidden="true"> ↗</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="empty-state">Add your teams to start choosing their shirts.</p>
        )}
      </section>
      <section className="order-outcome">
        <span className="assistant-kicker">WHAT YOU'LL TAKE AWAY</span>
        <h2>A clear brief for the seller.</h2>
        <p>
          Your selected shirts, sizes, quantities and costs, saved together after you review the
          matchups.
        </p>
        <button
          className="text-button"
          onClick={() => onNavigate(journey.confirmed ? "brief" : "plan")}
        >
          {journey.confirmed ? "Open order briefs" : "See Plan & order"} →
        </button>
      </section>
    </div>
  );
}

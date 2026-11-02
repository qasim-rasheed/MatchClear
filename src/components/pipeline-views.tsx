"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Workspace } from "@/server/workspace";
import type { PipelineState } from "@/server/pipeline";
import {
  viewModes,
  supportedRegion,
  TRANSFORM_VERSION,
  type Point,
  type ViewMode,
} from "@/domain/pipeline";
import { modeLabels, modeDetails } from "@/lib/vision/modes";
import { transformPixels } from "@/lib/vision/transforms";
import type { PlanResult, PlanningInput } from "@/lib/planner/solve";
import { formatMoney } from "@/domain/validation";
import { ChoiceConsequences } from "./completion-views";
import type { OrganizerFocus } from "@/domain/assistant-agent";

type Preview = PipelineState["previews"][number];
type Props = {
  data: Workspace;
  view: "previews" | "reviews" | "plan";
  onData: (value: Workspace) => void;
  pollingEnabled: boolean;
  onOrderBrief?: () => void;
  focus?: OrganizerFocus;
};
export function assetUrl(eventId: string, id: string) {
  return `/api/assets?event=${encodeURIComponent(eventId)}&id=${encodeURIComponent(id)}`;
}
const active = ["queued", "uploading", "submitting", "running"];

export function PipelineViews({ data, view, onData, pollingEnabled, onOrderBrief, focus }: Props) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pollingError, setPollingError] = useState(false);
  const latestRevision = useRef(data.event?.revision || 0);
  latestRevision.current = data.event?.revision || 0;
  const event = data.event!;
  const pipeline = data.pipeline!;
  const hasWork = pipeline.jobs.some((j) => active.includes(j.status));
  useEffect(() => {
    if (!hasWork)
      setNotice((value) =>
        value.startsWith("Planning queued")
          ? "Planning finished. Inspect the saved result below."
          : value,
      );
  }, [hasWork]);
  useEffect(() => {
    if (!pollingEnabled || busy) return;
    let ignore = false;
    const controller = new AbortController();
    const interval = setInterval(
      async () => {
        try {
          const r = await fetch(`/api/workspace?event=${encodeURIComponent(event.id)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const value = await r.json();
          if (!ignore) {
            setPollingError(!r.ok);
            if (r.ok && value.event.revision >= latestRevision.current) onData(value);
          }
        } catch {
          if (!ignore) setPollingError(true);
        }
      },
      hasWork ? 2500 : 8000,
    );
    return () => {
      ignore = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [event.id, hasWork, pollingEnabled, busy, onData]);
  async function command(op: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(
        ["confirmPlan", "createBrief"].includes(op) ? "/api/orders" : "/api/pipeline",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId: event.id, revision: event.revision, op, ...payload }),
        },
      );
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      onData(result);
      setNotice(
        op === "queuePreviews"
          ? "Ready options queued or reused. Watch their saved progress below."
          : op === "queuePlan"
            ? "Planning queued. The worker will evaluate current evidence."
            : "Saved. Related decisions have been updated.",
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this action.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function upload(form: FormData) {
    setBusy(true);
    setError("");
    setNotice("");
    form.set("eventId", event.id);
    form.set("revision", String(event.revision));
    try {
      const r = await fetch("/api/photos", { method: "POST", body: form });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      onData(value);
      setNotice("Photo saved locally. Replaced source evidence has been marked out of date.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The photo could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const workerRecent =
    pipeline.workerHeartbeat && Date.now() - Date.parse(pipeline.workerHeartbeat) < 20_000;
  const outdatedWorker = workerRecent && pipeline.workerReviewPolicy !== TRANSFORM_VERSION;
  return (
    <div className="pipeline-workspace">
      {outdatedWorker && (
        <p className="error-message" role="status">
          Your comparisons are saved. The background planner needs a restart before it can use them.
          Stop the old worker, then run <code>npm run worker</code>.
        </p>
      )}
      {hasWork && (
        <p className="work-status" role="status">
          {outdatedWorker
            ? "The background planner needs a restart. Your comparisons are saved."
            : workerRecent
              ? "Your saved jobs are being processed."
              : "Work is waiting. Start the background worker to continue."}
        </p>
      )}
      <details className="pipeline-details">
        <summary>Background activity & credits</summary>
        <div className="pipeline-banner">
          <span>
            <strong>
              {workerRecent
                ? pipeline.workerMode === "plans-only"
                  ? "Planning worker connected"
                  : pipeline.workerMode === "restricted"
                    ? "Restricted test worker connected"
                    : "Worker connected"
                : hasWork
                  ? "Worker needed for queued jobs"
                  : "Saved results available"}
            </strong>{" "}
            ·{" "}
            {workerRecent
              ? pipeline.workerMode === "plans-only"
                ? "Planning jobs only; preview jobs remain queued."
                : pipeline.workerMode === "restricted"
                  ? "Only specifically allowed test jobs can run."
                  : "Jobs continue when you leave this screen."
              : hasWork
                ? "Run npm run worker in another terminal to process jobs."
                : "No queued work for this event. Start the worker when generating or planning again."}
          </span>
          <span>
            {data.integration.estimatedUnits} / {pipeline.unitLimit} estimated units reserved
          </span>
        </div>
      </details>
      {error && (
        <div role="alert" className="error-message">
          {error}
          <button
            className="text-button"
            onClick={async () => {
              const r = await fetch(`/api/workspace?event=${encodeURIComponent(event.id)}`);
              if (r.ok) {
                onData(await r.json());
                setError("");
              }
            }}
          >
            Refresh saved data
          </button>
        </div>
      )}
      {pollingError && (
        <p className="error-message" role="status">
          Live refresh is unavailable. Showing the last saved data; check that the local application
          is running.
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {view === "previews" && (
        <PreviewStudio data={data} busy={busy} command={command} upload={upload} focus={focus} />
      )}
      {view === "reviews" && (
        <MatchupReview data={data} busy={busy} command={command} focus={focus} />
      )}
      {view === "plan" && (
        <PlanView
          key={JSON.stringify(pipeline.plannerLocks)}
          data={data}
          busy={busy}
          command={command}
          onOrderBrief={onOrderBrief}
        />
      )}
      <details className="job-history">
        <summary>Job history & recovery ({pipeline.jobs.length})</summary>
        <p className="small-copy">
          Cancelling locally cannot undo a provider submission or guarantee a refund. An uncertain
          submission is never automatically repeated.
        </p>
        {pipeline.jobs.map((j) => (
          <div className="job-row" key={j.id}>
            <span>
              <strong>{j.kind === "render" ? "Shirt preview" : "Tournament plan"}</strong>
              <small>
                {j.status.replaceAll("-", " ")} {j.errorCode ? `· ${j.errorCode}` : ""}
              </small>
            </span>
            <span>{j.estimatedUnits} estimated units</span>
            {active.includes(j.status) && (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => void command("cancelJob", { jobId: j.id })}
              >
                Cancel local job
              </button>
            )}
            {j.status === "needs-attention" && j.kind === "render" && j.hasProviderTask && (
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => void command("resumeJob", { jobId: j.id })}
              >
                Resume known task
              </button>
            )}
          </div>
        ))}
      </details>
    </div>
  );
}
type Actions = {
  busy: boolean;
  command: (op: string, payload: Record<string, unknown>) => Promise<boolean>;
};
function PhotoForm({
  kind,
  targetId,
  label,
  assetId,
  eventId,
  busy,
  upload,
}: {
  kind: "person" | "reference";
  targetId: string;
  label: string;
  assetId?: string | null;
  eventId: string;
  busy: boolean;
  upload: (form: FormData) => Promise<boolean>;
}) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (await upload(new FormData(form))) form.reset();
  }
  return (
    <form className="photo-form" onSubmit={submit}>
      <h3>{label}</h3>
      {assetId && (
        <img
          className="source-thumb"
          src={assetUrl(eventId, assetId)}
          alt={kind === "person" ? "Saved person photo" : "Saved garment reference"}
        />
      )}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="targetId" value={targetId} />
      <label className="field">
        <span>{kind === "person" ? "Adult person photo" : "Front-facing garment photo"}</span>
        <input name="photo" type="file" accept="image/jpeg,image/png" required />
      </label>
      <p className="small-copy">
        JPEG/PNG, under 10 MB, at least 384 pixels on both sides.{" "}
        {kind === "person"
          ? "One upright adult, face and shoulders visible; shirt area unobstructed."
          : "One front-facing garment. Use a photograph, not the catalog illustration."}
      </p>
      <label className="field">
        <span>Permission basis or photo source</span>
        <input
          name="basis"
          minLength={5}
          maxLength={300}
          placeholder="Own photo, or licensed stock photo source"
          required
        />
      </label>
      <label className="checkbox">
        <input type="checkbox" name="permission" value="true" required />I have permission to use
        this photo for this preview workflow.
      </label>
      {kind === "person" && (
        <label className="checkbox">
          <input type="checkbox" name="adult" value="true" required />
          The person is an adult. For a stock model, the license covers this use.
        </label>
      )}
      <button className="button secondary" disabled={busy || !targetId}>
        {assetId ? "Replace local photo" : "Save local photo"}
      </button>
    </form>
  );
}
function PreviewStudio({
  data,
  busy,
  command,
  upload,
  focus,
}: {
  data: Workspace;
  upload: (form: FormData) => Promise<boolean>;
  focus?: OrganizerFocus;
} & Actions) {
  const event = data.event!,
    pipeline = data.pipeline!;
  const [teamId, setTeamId] = useState(focus?.teamId || data.teams[0]?.id || "");
  const [designId, setDesignId] = useState(focus?.designId || "");
  const [consent, setConsent] = useState(false),
    [retry, setRetry] = useState(false);
  const [deleteId, setDeleteId] = useState("");
  const team = data.teams.find((t) => t.id === teamId) || data.teams[0];
  const designs = data.designs.filter((d) =>
    data.options.some((o) => o.teamId === team?.id && o.designId === d.id),
  );
  const design = designs.find((d) => d.id === designId) || designs[0];
  const personAsset = pipeline.assets.find((a) => a.id === team?.personAssetId && !a.deletedAt);
  const refAsset = pipeline.assets.find((a) => a.id === design?.assetId && !a.deletedAt);
  const current = pipeline.previews.find(
    (p) => p.teamId === team?.id && p.designId === design?.id && !p.stale && p.status !== "deleted",
  );
  const ready = data.options.filter((o) => {
    const t = data.teams.find((t) => t.id === o.teamId);
    const d = data.designs.find((d) => d.id === o.designId);
    return (
      pipeline.assets.some((a) => a.id === t?.personAssetId && !a.deletedAt) &&
      pipeline.assets.some((a) => a.id === d?.assetId && !a.deletedAt)
    );
  });
  if (!team) return <p className="empty-state">Add a team before uploading preview inputs.</p>;
  return (
    <>
      <div className="pipeline-controls">
        <label className="field">
          <span>Team</span>
          <select
            value={team.id}
            onChange={(e) => {
              setTeamId(e.target.value);
              setDesignId("");
            }}
          >
            {data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Assigned shirt design</span>
          <select value={design?.id || ""} onChange={(e) => setDesignId(e.target.value)}>
            <option value="" disabled>
              Assign a shirt option first
            </option>
            {designs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details
        key={`${team.id}:${design?.id}:sources`}
        className="source-photo-inputs"
        open={!personAsset || !refAsset}
      >
        <summary>
          {!personAsset || !refAsset ? "Add your two photos" : "Change source photos"}
        </summary>
        <div className="photo-grid">
          <PhotoForm
            key={`person-${team.id}`}
            kind="person"
            targetId={team.id}
            label="1. The person"
            assetId={personAsset?.id}
            eventId={event.id}
            busy={busy}
            upload={upload}
          />
          {design && (
            <PhotoForm
              key={`reference-${design.id}`}
              kind="reference"
              targetId={design.id}
              label="2. The actual shirt"
              assetId={refAsset?.id}
              eventId={event.id}
              busy={busy}
              upload={upload}
            />
          )}
        </div>
      </details>
      <details
        key={`${team.id}:${design?.id}:generate`}
        className="preview-generation"
        open={!current?.outputAssetId}
      >
        <summary>
          {current?.outputAssetId ? "Generate another preview" : "Create the preview"}
        </summary>
        <section className="generation-panel">
          <h2>Preview this shirt on a player</h2>
          <p>
            Each new V3 render reserves an estimated 2 units. Matching current jobs or results are
            reused; no duplicate render is submitted for them.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I understand the selected person and garment photos will be sent to YouCam for this
            task.
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={retry} onChange={(e) => setRetry(e.target.checked)} />
            Explicitly allow a new attempt after a confirmed failure or cancellation (another
            estimated 2 units).
          </label>
          <div className="button-row">
            <button
              className="button"
              disabled={busy || !consent || !personAsset || !refAsset || !design}
              onClick={() =>
                void command("queuePreviews", {
                  consentConfirmed: true,
                  items: [{ teamId: team.id, designId: design!.id }],
                  retryFailed: retry,
                })
              }
            >
              Generate selected preview · up to 2 units
            </button>
            <button
              className="button secondary"
              disabled={busy || !consent || !ready.length || ready.length > 8}
              onClick={() =>
                void command("queuePreviews", {
                  consentConfirmed: true,
                  items: ready.map((o) => ({ teamId: o.teamId, designId: o.designId })),
                  retryFailed: retry,
                })
              }
            >
              Queue ready options · up to {ready.length * 2} units
            </button>
          </div>
        </section>
      </details>
      {current ? (
        <section className="preview-evidence">
          <div className="section-title">
            <div>
              <h2>Your preview</h2>
              <p>
                {current.stale ? "Outdated" : current.status.replaceAll("-", " ")} · appearance{" "}
                {current.acceptance}
              </p>
            </div>
          </div>
          {current.outputAssetId ? (
            <>
              <div className="render-comparison">
                <figure>
                  <img
                    src={assetUrl(event.id, current.referenceAssetId)}
                    alt="Original garment reference"
                  />
                  <figcaption>Shirt photo</figcaption>
                </figure>
                <figure>
                  <img
                    src={assetUrl(event.id, current.personAssetId)}
                    alt="Original person photo"
                  />
                  <figcaption>Player photo</figcaption>
                </figure>
                <figure>
                  <img
                    src={assetUrl(event.id, current.outputAssetId)}
                    alt="YouCam generated appearance preview"
                  />
                  <figcaption>YouCam preview</figcaption>
                </figure>
              </div>
              <form
                className="acceptance-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const button = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
                  void command("acceptPreview", {
                    previewId: current.id,
                    acceptance: button.value,
                    reviewer: String(f.get("reviewer")),
                    reason: String(f.get("reason")),
                  });
                }}
              >
                <h3>Does the preview represent the shirt?</h3>
                <p>
                  Check the colours, pattern and sleeves against the shirt photo. Accepting
                  appearance is separate from approving an opposing combination.
                </p>
                <div className="form-row">
                  <label className="field">
                    <span>Reviewer name or initials</span>
                    <input name="reviewer" minLength={2} maxLength={80} required />
                  </label>
                  <label className="field">
                    <span>Inspection notes</span>
                    <input
                      name="reason"
                      minLength={5}
                      maxLength={1000}
                      required
                      placeholder="What was preserved or changed?"
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button className="button" name="decision" value="accepted" disabled={busy}>
                    Accept appearance
                  </button>
                  <button
                    className="button secondary danger"
                    name="decision"
                    value="rejected"
                    disabled={busy}
                  >
                    Reject appearance
                  </button>
                </div>
              </form>
              {current.acceptance === "accepted" && (
                <RegionEditor
                  key={`${current.id}:${current.region?.revision || 0}`}
                  eventId={event.id}
                  preview={current}
                  busy={busy}
                  onSave={(polygon) => command("saveRegion", { previewId: current.id, polygon })}
                />
              )}
            </>
          ) : (
            <p className="form-note">
              The saved job will update here. You can leave this screen or restart the worker; known
              task IDs are preserved.
            </p>
          )}
        </section>
      ) : (
        <p className="empty-state">
          No current render for this team and shirt. Save the two photos, then generate a preview.
        </p>
      )}
      <details className="job-history">
        <summary>Local photo deletion</summary>
        <p>
          Deleting a local source also removes its linked local outputs and invalidates reviews. It
          does not request deletion from YouCam or remove copies already downloaded.
        </p>
        <label className="field">
          <span>Photo to remove locally</span>
          <select value={deleteId} onChange={(e) => setDeleteId(e.target.value)}>
            <option value="">Choose a photo</option>
            {pipeline.assets
              .filter((a) => !a.deletedAt && a.kind !== "output")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.kind}: {String(a.permission.uploadName || a.id).slice(0, 60)}
                </option>
              ))}
          </select>
        </label>
        {deleteId && (
          <div className="delete-confirm">
            <p>Confirm removal of this local photo and its linked local render files.</p>
            <button
              className="button secondary danger"
              disabled={busy}
              onClick={async () => {
                if (await command("deleteAsset", { assetId: deleteId })) setDeleteId("");
              }}
            >
              Confirm local photo deletion
            </button>
            <button className="text-button" onClick={() => setDeleteId("")}>
              Keep photo
            </button>
          </div>
        )}
      </details>
    </>
  );
}

function RegionEditor({
  eventId,
  preview,
  busy,
  onSave,
}: {
  eventId: string;
  preview: Preview;
  busy: boolean;
  onSave: (p: Point[]) => Promise<boolean>;
}) {
  const [points, setPoints] = useState<Point[]>((preview.region?.polygon as Point[]) || []);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="region-editor">
      <div>
        <h3>Mark the shirt, then confirm the outline</h3>
        <p>
          Click around the shirt in order, using at least three points. Keep the face and background
          outside. This keeps the comparison focused on the fabric.
        </p>
        <div className="button-row">
          <button
            className="button secondary small"
            type="button"
            onClick={() => {
              setPoints([
                { x: 0.3, y: 0.35 },
                { x: 0.7, y: 0.35 },
                { x: 0.7, y: 0.85 },
                { x: 0.3, y: 0.85 },
              ]);
              setConfirmed(false);
            }}
          >
            Start adjustable rectangle
          </button>
          <button
            className="button secondary small"
            type="button"
            onClick={() => {
              setPoints([]);
              setConfirmed(false);
            }}
          >
            Clear outline
          </button>
        </div>
        <details>
          <summary>Edit outline points</summary>
          <div className="point-inputs">
            {points.map((p, i) => (
              <div key={i}>
                <span>Point {i + 1}</span>
                {(["x", "y"] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      aria-label={`Point ${i + 1} ${axis}`}
                      type="number"
                      min="0"
                      max="1"
                      step=".01"
                      value={p[axis]}
                      onChange={(e) => {
                        setPoints((old) =>
                          old.map((point, index) =>
                            index === i ? { ...point, [axis]: Number(e.target.value) } : point,
                          ),
                        );
                        setConfirmed(false);
                      }}
                    />
                  </label>
                ))}
              </div>
            ))}
          </div>
        </details>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I checked that this outline marks the shirt area.
        </label>
        <button
          className="button"
          disabled={busy || points.length < 3 || !confirmed}
          onClick={() => void onSave(points)}
        >
          Save confirmed shirt area
        </button>
      </div>
      <div className="region-image">
        <img
          src={assetUrl(eventId, preview.outputAssetId!)}
          alt="Accepted preview with editable shirt outline"
        />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          onPointerDown={(e) => {
            if (points.length >= 12) return;
            const r = e.currentTarget.getBoundingClientRect();
            setPoints((old) => [
              ...old,
              {
                x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000,
                y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000,
              },
            ]);
            setConfirmed(false);
          }}
          aria-label="Click to mark the shirt outline"
        >
          {points.length > 1 && (
            <polygon
              points={points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
              fill="#d6edbb40"
              stroke="#265534"
              strokeWidth=".7"
            />
          )}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x * 100}
              cy={p.y * 100}
              r="1"
              fill="#fff"
              stroke="#265534"
              strokeWidth=".5"
            />
          ))}
        </svg>
      </div>
    </section>
  );
}

function ScreenImage({
  eventId,
  preview,
  mode,
  cropped,
  small,
  onReady,
}: {
  eventId: string;
  preview: Preview;
  mode: ViewMode;
  cropped: boolean;
  small: boolean;
  onReady: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let ignore = false;
    const image = new Image();
    image.onload = () => {
      if (ignore || !canvas.current) return;
      const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
      const w = Math.round(image.naturalWidth * scale),
        h = Math.round(image.naturalHeight * scale);
      const work = document.createElement("canvas");
      work.width = w;
      work.height = h;
      const c = work.getContext("2d", { willReadFrequently: true })!;
      c.drawImage(image, 0, 0, w, h);
      const pixels = c.getImageData(0, 0, w, h);
      pixels.data.set(transformPixels(pixels.data, mode));
      c.putImageData(pixels, 0, 0);
      let x = 0,
        y = 0,
        width = w,
        height = h;
      const points = preview.region?.polygon as Point[] | undefined;
      if (cropped && points?.length) {
        const left = Math.min(...points.map((p) => p.x)),
          top = Math.min(...points.map((p) => p.y));
        x = Math.floor(left * w);
        y = Math.floor(top * h);
        width = Math.max(1, Math.ceil((Math.max(...points.map((p) => p.x)) - left) * w));
        height = Math.max(1, Math.ceil((Math.max(...points.map((p) => p.y)) - top) * h));
      }
      const target = canvas.current;
      target.width = width;
      target.height = height;
      const t = target.getContext("2d")!;
      t.clearRect(0, 0, width, height);
      if (cropped && points?.length) {
        t.beginPath();
        points.forEach((p, i) => {
          if (!i) t.moveTo(p.x * w - x, p.y * h - y);
          else t.lineTo(p.x * w - x, p.y * h - y);
        });
        t.closePath();
        t.clip();
      }
      t.drawImage(work, x, y, width, height, 0, 0, width, height);
      setError("");
      onReady();
    };
    image.onerror = () => {
      if (!ignore) setError("This private image is unavailable. Refresh the current evidence.");
    };
    image.src = assetUrl(eventId, preview.outputAssetId!);
    return () => {
      ignore = true;
    };
  }, [
    eventId,
    preview.id,
    preview.outputAssetId,
    preview.region?.revision,
    mode,
    cropped,
    onReady,
  ]);
  return (
    <div className={`screen-image ${small ? "small-screen-image" : ""}`}>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${modeLabels[mode]} ${cropped ? "shirt-region" : "whole-person"} screening preview`}
        />
      )}
    </div>
  );
}

function MatchupReview({
  data,
  busy,
  command,
  focus,
}: { data: Workspace; focus?: OrganizerFocus } & Actions) {
  const event = data.event!,
    pipeline = data.pipeline!;
  const [fixtureId, setFixtureId] = useState(focus?.fixtureId || data.fixtures[0]?.id || "");
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [mode, setMode] = useState<ViewMode>("normal"),
    [cropped, setCropped] = useState(true),
    [small, setSmall] = useState(false);
  const fixture = data.fixtures.find((f) => f.id === fixtureId) || data.fixtures[0];
  const aOptions = data.options.filter((o) => o.teamId === fixture?.teamA),
    bOptions = data.options.filter((o) => o.teamId === fixture?.teamB);
  const a = aOptions.find((o) => o.id === aId) || aOptions[0],
    b = bOptions.find((o) => o.id === bId) || bOptions[0];
  const find = (teamId?: string, designId?: string) =>
    pipeline.previews.find(
      (p) =>
        p.teamId === teamId && p.designId === designId && p.usable && supportedRegion(p.region),
    );
  const pa = find(fixture?.teamA, a?.designId),
    pb = find(fixture?.teamB, b?.designId);
  const evidenceKey = `${TRANSFORM_VERSION}:${fixture?.id}:${a?.id}:${b?.id}:${pa?.id}:${pa?.revision}:${pa?.region?.revision}:${pb?.id}:${pb?.revision}:${pb?.region?.revision}`;
  const [seen, setSeen] = useState<Record<string, string[]>>({});
  const mark = useCallback(
    (side: string) =>
      setSeen((old) => {
        const key = `${evidenceKey}:${mode}`;
        const previous = old[key] || [];
        return previous.includes(side) ? old : { ...old, [key]: [...previous, side] };
      }),
    [evidenceKey, mode],
  );
  const onA = useCallback(() => mark("a"), [mark]),
    onB = useCallback(() => mark("b"), [mark]);
  const viewed = viewModes.filter((m) => (seen[`${evidenceKey}:${m}`] || []).length === 2);
  if (!fixture)
    return <p className="empty-state">Add opposing fixtures before reviewing combinations.</p>;
  const records = pipeline.reviews.filter(
    (r) => r.fixtureId === fixture.id && r.optionA === a?.id && r.optionB === b?.id,
  );
  return (
    <>
      <div className="pipeline-controls">
        <label className="field">
          <span>Fixture</span>
          <select
            value={fixture.id}
            onChange={(e) => {
              setFixtureId(e.target.value);
              setAId("");
              setBId("");
            }}
          >
            {data.fixtures.map((f) => (
              <option value={f.id} key={f.id}>
                {f.label}: {data.teams.find((t) => t.id === f.teamA)?.name} vs{" "}
                {data.teams.find((t) => t.id === f.teamB)?.name}
              </option>
            ))}
          </select>
        </label>
        {[
          ["First team shirt", a?.id, aOptions, setAId],
          ["Opposing team shirt", b?.id, bOptions, setBId],
        ].map(([label, value, options, setter]) => (
          <label className="field" key={String(label)}>
            <span>{String(label)}</span>
            <select
              value={String(value || "")}
              onChange={(e) => (setter as (s: string) => void)(e.target.value)}
            >
              {(options as typeof aOptions).map((o) => (
                <option key={o.id} value={o.id}>
                  {data.designs.find((d) => d.id === o.designId)?.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p className="form-note">
        Compare the previews with the original garments. Choose Inconclusive if the evidence is
        unreliable.
      </p>
      {pa && pb ? (
        <>
          <div className="mode-controls" aria-label="Screening mode">
            {viewModes.map((m) => (
              <button
                key={m}
                className={`button ${mode === m ? "" : "secondary"}`}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {modeLabels[m]} {viewed.includes(m) ? "✓" : ""}
              </button>
            ))}
          </div>
          <p className="mode-hint">{modeDetails[mode].hint}</p>
          <details className="screening-info">
            <summary>About these views</summary>
            <dl>
              {viewModes.map((m) => (
                <div key={m}>
                  <dt>{modeDetails[m].name}</dt>
                  <dd>{modeDetails[m].explanation}</dd>
                </div>
              ))}
            </dl>
            <p>
              These are screening aids, not a certification of physical colours or field visibility.
              Partial-loss examples use model setting 0.5, not “50% vision”. Grayscale checks
              colour-free contrast; it does not reproduce every form of monochromacy. These views
              cover major red–green and blue–yellow screening categories, not every severity,
              acquired condition or rare subtype.
            </p>
            <a
              href="https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/color-blindness/types-color-vision-deficiency"
              target="_blank"
              rel="noreferrer"
            >
              Colour-vision types ↗
            </a>
          </details>
          {records.length > 0 && !records.some((r) => r.current) && (
            <p className="form-note">
              Older evidence needs review. Inspect all {viewModes.length} views to record a current
              decision.
            </p>
          )}
          <div className="button-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={cropped}
                onChange={(e) => setCropped(e.target.checked)}
              />
              Confirmed shirt areas only
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={small} onChange={(e) => setSmall(e.target.checked)} />
              Reduced screen size (no field-distance claim)
            </label>
          </div>
          <div className="comparison-grid">
            {[
              { p: pa, side: "a", cb: onA },
              { p: pb, side: "b", cb: onB },
            ].map(({ p, side, cb }) => (
              <figure key={side}>
                <h3>{data.teams.find((t) => t.id === p.teamId)?.name}</h3>
                <ScreenImage
                  eventId={event.id}
                  preview={p}
                  mode={mode}
                  cropped={cropped}
                  small={small}
                  onReady={cb}
                />
                <details>
                  <summary>Original garment reference</summary>
                  <img
                    className="review-reference"
                    src={assetUrl(event.id, p.referenceAssetId)}
                    alt="Original garment reference for this preview"
                  />
                </details>
              </figure>
            ))}
          </div>
          <form
            key={evidenceKey}
            className="review-decision"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void command("reviewPair", {
                fixtureId: fixture.id,
                optionA: a.id,
                optionB: b.id,
                previewA: pa.id,
                previewB: pb.id,
                status: String(f.get("decision")),
                reviewer: String(f.get("reviewer")),
                reason: String(f.get("reason")),
                viewedModes: viewed,
              });
            }}
          >
            <h3>Record your screen-review decision</h3>
            <p>
              {viewed.length} of {viewModes.length} views checked.
            </p>
            <div className="form-row">
              <label className="field">
                <span>Reviewer</span>
                <input name="reviewer" minLength={2} maxLength={80} required />
              </label>
              <label className="field">
                <span>Decision</span>
                <select name="decision">
                  <option value="inconclusive">Inconclusive — more evidence needed</option>
                  <option value="approved">Approve this screen-reviewed combination</option>
                  <option value="rejected">Reject this combination</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>Reason and limits observed</span>
              <textarea name="reason" minLength={5} maxLength={1000} required rows={3} />
            </label>
            <label className="checkbox">
              <input type="checkbox" required />I inspected the images and references; this records
              my review, not an automatic accessibility certificate.
            </label>
            <button className="button" disabled={busy || viewed.length !== viewModes.length}>
              Save human review
            </button>
          </form>
        </>
      ) : (
        <p className="empty-state">
          Both choices need a current accepted render and a confirmed shirt outline in Preview
          Studio before this pair can be reviewed.
        </p>
      )}
      <section className="review-history">
        <h3>Review history for these choices</h3>
        {records.length ? (
          records.map((r) => (
            <article key={r.id}>
              <span className="status-tag">{r.current ? r.status : "outdated"}</span>
              <strong>{r.reviewer}</strong>
              <p>{r.reason}</p>
              {r.staleReason && <small>{r.staleReason}</small>}
            </article>
          ))
        ) : (
          <p>No decision has been recorded for this pair.</p>
        )}
      </section>
    </>
  );
}

function PlanView({
  data,
  busy,
  command,
  onOrderBrief,
}: { data: Workspace; onOrderBrief?: () => void } & Actions) {
  const event = data.event!,
    pipeline = data.pipeline!;
  const [baseline, setBaseline] = useState<Record<string, string>>({}),
    [locks, setLocks] = useState<Record<string, string>>(data.pipeline!.plannerLocks);
  const selected = Object.fromEntries(
    data.teams.map((t) => [
      t.id,
      baseline[t.id] || locks[t.id] || data.options.find((o) => o.teamId === t.id)?.id || "",
    ]),
  );
  const [planId, setPlanId] = useState("");
  const plan = pipeline.plans.find((p) => p.id === planId) || pipeline.plans[0];
  const snapshot = plan?.snapshot as { input: PlanningInput; result: PlanResult } | undefined;
  return (
    <>
      <section className="plan-inputs">
        <h2>Any shirts that must stay?</h2>
        <p>Choose the current shirts. Keep a choice fixed only when it cannot change.</p>
        <div className="plan-team-choices">
          {data.teams.map((t) => (
            <div key={t.id}>
              <label className="field">
                <span>{t.name}</span>
                <select
                  value={selected[t.id]}
                  onChange={(e) => {
                    setBaseline((old) => ({ ...old, [t.id]: e.target.value }));
                    if (locks[t.id]) setLocks((old) => ({ ...old, [t.id]: e.target.value }));
                  }}
                >
                  <option value="" disabled>
                    No shirt options
                  </option>
                  {data.options
                    .filter((o) => o.teamId === t.id)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {data.designs.find((d) => d.id === o.designId)?.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(locks[t.id])}
                  disabled={!selected[t.id]}
                  onChange={(e) =>
                    setLocks((old) => {
                      const next = { ...old };
                      if (e.target.checked) next[t.id] = selected[t.id];
                      else delete next[t.id];
                      return next;
                    })
                  }
                />
                Keep this shirt
              </label>
            </div>
          ))}
        </div>
        <div className="button-row">
          <button
            className="button"
            disabled={busy || !data.teams.length || Object.values(selected).some((v) => !v)}
            onClick={() =>
              void command("queuePlan", { baseline: selected, locks }).then((saved) => {
                if (saved) setPlanId("");
              })
            }
          >
            Find a shirt plan
          </button>
          <strong>Budget: {formatMoney(event.budgetMinor, event.currency)}</strong>
        </div>
      </section>
      <details className="choice-effects">
        <summary>See affected matches</summary>
        <ChoiceConsequences data={data} selection={selected} />
      </details>
      {plan && snapshot ? (
        <section className="plan-result">
          <div className="section-title">
            <div>
              <h2>
                {plan.stale
                  ? "Outdated planning result"
                  : (
                      {
                        optimal: "A complete reviewed plan",
                        feasible: "A feasible plan; lowest cost unproven",
                        incomplete: "More evidence is needed",
                        infeasible: "No valid plan for these constraints",
                        limit: "Search limit reached",
                        cancelled: "Planning cancelled",
                      } as Record<string, string>
                    )[snapshot.result.status]}
              </h2>
              <p>{snapshot.result.explanations.join(" ")}</p>
            </div>
            <span className="status-tag">
              {plan.stale ? "Recompute before use" : snapshot.result.status}
            </span>
          </div>
          {pipeline.plans.length > 1 && (
            <label className="field">
              <span>Saved planning run</span>
              <select value={plan.id} onChange={(e) => setPlanId(e.target.value)}>
                {pipeline.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.createdAt} · {p.status}
                    {p.stale ? " · outdated" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {snapshot.result.totalMinor !== null && (
            <div className="plan-cost">
              <strong>{formatMoney(snapshot.result.totalMinor, event.currency)}</strong>
              <span>{snapshot.result.changes} changes from the supplied starting choices</span>
            </div>
          )}
          {!plan.stale &&
            snapshot.result.selection &&
            ["optimal", "feasible"].includes(plan.status) &&
            (pipeline.confirmations.some((c) => c.planId === plan.id) ? (
              <div className="form-note">
                <strong>Plan confirmed.</strong>
                <button className="button secondary" onClick={onOrderBrief}>
                  Continue to Order Brief
                </button>
              </div>
            ) : (
              <form
                className="completion-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void command("confirmPlan", {
                    planId: plan.id,
                    reviewer: String(form.get("reviewer")),
                  });
                }}
              >
                <h3>Confirm this selection</h3>
                <p className="small-copy">
                  Confirming freezes the recorded order information for export. It does not place an
                  order.
                </p>
                <label className="field">
                  <span>Organizer name or initials</span>
                  <input name="reviewer" minLength={2} maxLength={80} required />
                </label>
                <label className="checkbox">
                  <input type="checkbox" required />I checked this selection, quantities, costs and
                  review limitations
                </label>
                <button className="button" disabled={busy}>
                  Confirm plan for order brief
                </button>
              </form>
            ))}
          {snapshot.result.selection && (
            <div className="fixture-list">
              {snapshot.input.teams.map((t) => {
                const id = snapshot.result.selection![t.id];
                const option = snapshot.input.candidates.find((o) => o.id === id)!;
                const previousId = snapshot.input.baseline[t.id];
                const previous = snapshot.input.candidates.find((o) => o.id === previousId);
                const affected = snapshot.input.fixtures.filter(
                  (f) => f.teamA === t.id || f.teamB === t.id,
                );
                return (
                  <div className="fixture-row" key={t.id}>
                    <strong>{t.name}</strong>
                    <span>
                      {option.label.split(": ").slice(1).join(": ")}
                      {previousId && previousId !== id && (
                        <small className="plan-change">
                          Changed from {previous?.label || "previous choice"}. Affects:{" "}
                          {affected.map((f) => f.label).join(", ") || "no scheduled fixtures"}.
                        </small>
                      )}
                    </span>
                    <strong>{formatMoney(option.costMinor, event.currency)}</strong>
                  </div>
                );
              })}
            </div>
          )}
          {snapshot.result.missingPreviews.length > 0 && (
            <div className="form-note">
              <strong>Accepted preview evidence needed</strong>
              <ul>
                {snapshot.result.missingPreviews.map((id) => (
                  <li key={id}>{snapshot.input.candidates.find((o) => o.id === id)?.label}</li>
                ))}
              </ul>
            </div>
          )}
          {snapshot.result.missingReviews.length > 0 && (
            <div className="form-note">
              <strong>Next pairs to review</strong>
              <ul>
                {snapshot.result.missingReviews.map((r, i) => (
                  <li key={i}>
                    {snapshot.input.fixtures.find((f) => f.id === r.fixtureId)?.label}:{" "}
                    {snapshot.input.candidates.find((o) => o.id === r.optionA)?.label} vs{" "}
                    {snapshot.input.candidates.find((o) => o.id === r.optionB)?.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {snapshot.input.excluded.length > 0 && (
            <details>
              <summary>Options excluded by purchasing constraints</summary>
              <ul>
                {snapshot.input.excluded.map((o) => (
                  <li key={o.optionId}>
                    {data.designs.find(
                      (d) =>
                        d.id === data.options.find((option) => option.id === o.optionId)?.designId,
                    )?.name || o.optionId}
                    : {o.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details className="pipeline-details">
            <summary>How this was calculated</summary>
            <p className="small-copy">
              {snapshot.result.nodes.toLocaleString()} search nodes · {snapshot.result.elapsedMs} ms
              · input revision {plan.eventRevision}. Costs and stock reflect the supplied records,
              not live retailer confirmation.
            </p>
          </details>
          {snapshot.result.selection && (
            <div className="fixture-list">
              {snapshot.input.fixtures.map((f) => (
                <div key={f.id} className="fixture-row">
                  <strong>{f.label}</strong>
                  <span>
                    {snapshot.input.teams.find((t) => t.id === f.teamA)?.name} vs{" "}
                    {snapshot.input.teams.find((t) => t.id === f.teamB)?.name}
                  </span>
                  <span className="status-tag">Recorded approval satisfied</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <p className="empty-state">
          No planning run yet. The worker will explain missing evidence or return a complete
          selection.
        </p>
      )}
    </>
  );
}

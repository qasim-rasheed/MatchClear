"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Workspace } from "@/server/workspace";
import type { AgentReply, OrganizerSection, OrganizerFocus } from "@/domain/assistant-agent";
import { assistantSuggestions, organizerJourney } from "@/lib/organizer-journey";
import { formatMoney } from "@/domain/validation";

type Message = AgentReply & { id: string; role: "user" | "assistant"; applied?: boolean };
type Props = {
  data: Workspace;
  open: boolean;
  modal: boolean;
  section: OrganizerSection;
  pollingEnabled: boolean;
  onClose: () => void;
  onContinue: () => void;
  onNavigate: (tab: OrganizerSection, focus?: OrganizerFocus) => void;
  onData: (data: Workspace) => void;
};
export function AssistantDock({
  data,
  open,
  modal,
  section,
  pollingEnabled,
  onClose,
  onContinue,
  onNavigate,
  onData,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pendingJob, setPendingJob] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null),
    inFlight = useRef(false),
    log = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLElement>(null),
    latestRevision = useRef(data.event?.revision || 0);
  latestRevision.current = data.event?.revision || 0;
  const [present, setPresent] = useState(open),
    [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (open) {
      setPresent(true);
      let secondFrame = 0;
      const firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setExpanded(true));
      });
      return () => {
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
      };
    }
    setExpanded(false);
    const timer = setTimeout(() => setPresent(false), 260);
    return () => clearTimeout(timer);
  }, [open]);
  const suggestions = assistantSuggestions(data, section),
    next = organizerJourney(data).next;
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, busy, open]);
  useEffect(() => {
    if (!open || !expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = panel.current;
    element?.querySelector<HTMLButtonElement>("button")?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (!modal || event.key !== "Tab" || !element) return;
      const nodes = Array.from(
        element.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea, input, summary, a[href]",
        ),
      ).filter((n) => n.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
      else
        document
          .querySelector<HTMLButtonElement>('[aria-controls="tournament-assistant"]')
          ?.focus();
    };
  }, [open, expanded, modal, onClose]);
  useEffect(() => {
    if (!pendingJob || !data.event || !pollingEnabled) return;
    const eventId = data.event.id,
      abort = new AbortController();
    const started = Date.now();
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      if (Date.now() - started > 120000) {
        clearInterval(timer);
        setPendingJob(null);
        setMessages((old) => [
          ...old,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            message:
              "The plan is still waiting to finish. You can check its progress in Plan & order.",
            navigation: { tab: "plan", label: "Check progress" },
          },
        ]);
        return;
      }
      running = true;
      try {
        const response = await fetch(`/api/workspace?event=${encodeURIComponent(eventId)}`, {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!response.ok || abort.signal.aborted) return;
        const value = (await response.json()) as Workspace;
        if (value.event!.revision >= latestRevision.current) onData(value);
        const job = value.pipeline?.jobs.find((j) => j.id === pendingJob);
        if (job && ["success", "failed", "cancelled", "needs-attention"].includes(job.status)) {
          clearInterval(timer);
          setPendingJob(null);
          const plan = value.pipeline!.plans.find((p) => p.id === pendingJob);
          const result = plan?.snapshot as
            { result?: { status?: string; totalMinor?: number | null } } | undefined;
          const complete = plan && !plan.stale && ["optimal", "feasible"].includes(plan.status);
          setMessages((old) => [
            ...old,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              message: complete
                ? `Your shirt plan is ready${result?.result?.totalMinor != null ? `: ${formatMoney(result.result.totalMinor, value.event!.currency)}` : ""}. Check it before confirming the order.`
                : "The planner finished, but the selection still needs attention. Open the result to see which choices or reviews are missing.",
              navigation: { tab: "plan", label: "See the result" },
            },
          ]);
        }
      } catch {
        /* Keep saved chat available during a temporary local connection failure. */
      } finally {
        running = false;
      }
    }, 2500);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [pendingJob, data.event?.id, pollingEnabled, onData]);

  async function send(value: string, suggestionId?: string) {
    if (!data.event || inFlight.current || !value.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setText("");
    setMessages((old) => [...old, { id: crypto.randomUUID(), role: "user", message: value }]);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch("/api/assistant/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "prepare",
          eventId: data.event.id,
          revision: data.event.revision,
          text: value,
          suggestionId,
          consent: true,
          section,
        }),
        signal: abort.signal,
      });
      const reply = await response.json();
      if (!response.ok) throw new Error(reply.error || "That request couldn't be prepared.");
      if (!abort.signal.aborted)
        setMessages((old) => [...old, { ...reply, id: crypto.randomUUID(), role: "assistant" }]);
    } catch (error) {
      if (!abort.signal.aborted) {
        setError(error instanceof Error ? error.message : "Please try again.");
        if (!suggestionId) setText(value);
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false);
      inFlight.current = false;
    }
  }
  async function apply(message: Message) {
    if (!message.proposal || !data.event || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch("/api/assistant/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "apply",
          eventId: data.event.id,
          revision: message.proposal.revision,
          draftId: message.proposal.id,
          confirmed: true,
        }),
        signal: abort.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Those changes couldn't be saved.");
      if (abort.signal.aborted) return;
      onData(result.data);
      setMessages((old) => [
        ...old.map((m) => (m.id === message.id ? { ...m, applied: true } : m)),
        {
          id: crypto.randomUUID(),
          role: "assistant",
          message: result.message,
          facts: result.steps,
          navigation: result.navigation,
        },
      ]);
      if (result.jobId) setPendingJob(result.jobId);
      onNavigate(result.navigation.tab, result.navigation);
    } catch (error) {
      if (!abort.signal.aborted)
        setError(error instanceof Error ? error.message : "Please try again.");
    } finally {
      if (!abort.signal.aborted) setBusy(false);
      inFlight.current = false;
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void send(text);
  }
  return (
    <aside
      ref={panel}
      id="tournament-assistant"
      className="assistant-dock"
      hidden={!present}
      inert={!open}
      aria-hidden={!open}
      data-state={expanded ? "open" : "closed"}
      role="dialog"
      aria-modal={modal && open ? true : undefined}
      aria-label="Tournament assistant"
    >
      <header className="assistant-heading">
        <div>
          <h2>MatchClear assistant</h2>
        </div>
        <button className="icon-button" aria-label="Close assistant" onClick={onClose}>
          ×
        </button>
      </header>
      <div
        className="assistant-log"
        ref={log}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div className="assistant-welcome">
          <strong>
            {data.event
              ? `Let's work on ${data.event.name}.`
              : "Let's get your tournament started."}
          </strong>

          <button className="assistant-start" onClick={onContinue}>
            {next.button} <span aria-hidden="true">→</span>
          </button>
        </div>
        {messages.map((m) => (
          <article key={m.id} className={`assistant-message ${m.role}`}>
            <span className="sr-only">{m.role === "user" ? "You" : "Assistant"}</span>
            <p>{m.message}</p>
            {m.facts?.length ? (
              <ul>
                {m.facts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            ) : null}
            {m.proposal && (
              <div className="assistant-proposal">
                <span className="assistant-kicker">PROPOSED CHANGES</span>
                <ol>
                  {m.proposal.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                {m.applied ? (
                  <span className="assistant-applied">Applied</span>
                ) : (
                  <>
                    <button
                      className="button small"
                      disabled={busy || m.proposal.revision !== data.event?.revision}
                      onClick={() => void apply(m)}
                    >
                      Apply these changes
                    </button>
                    {m.proposal.revision !== data.event?.revision && (
                      <small>The tournament changed. Ask for a fresh proposal.</small>
                    )}
                  </>
                )}
              </div>
            )}
            {m.navigation && (
              <button
                className="text-button"
                onClick={() => onNavigate(m.navigation!.tab, m.navigation)}
              >
                {m.navigation.label} →
              </button>
            )}
          </article>
        ))}
        {pendingJob && (
          <p className="assistant-working" role="status">
            Watching for your plan…
          </p>
        )}
        {busy && (
          <p className="assistant-working" role="status">
            Checking your tournament…
          </p>
        )}
        {error && (
          <p className="assistant-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="assistant-suggestions">
        <span className="assistant-kicker">SUGGESTED ACTIONS</span>
        <div>
          {suggestions.map((s) => (
            <button
              key={s.id}
              disabled={busy || !data.event}
              title={s.prompt}
              onClick={() => void send(s.prompt, s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <form className="assistant-compose" onSubmit={submit}>
        <label className="sr-only" htmlFor="assistant-request">
          Ask about this tournament
        </label>
        <textarea
          id="assistant-request"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            data.teams.length > 1
              ? `e.g. Set the budget to 400 and find a plan`
              : "e.g. Add teams Northbank and Parkside"
          }
          maxLength={4000}
          rows={2}
          disabled={!data.event || busy}
        />
        <div className="assistant-compose-actions">
          <span className="assistant-ai-note">AI when needed · No photos sent</span>
          <button className="button small" disabled={busy || !text.trim() || !data.event}>
            Send
          </button>
        </div>
        <details className="assistant-privacy">
          <summary>What can it do?</summary>
          <p>
            Prepare teams, sizes, matches, budgets and fixed choices; run plans and prepare a brief
            after you confirm the plan. Changes are shown before you apply them. Visual reviews and
            photo uploads stay with you.
          </p>
          <p>
            Quick actions stay local. Written requests automatically use AI when needed. Those
            instructions and saved tournament text—including names, sizes, prices and choices—go to
            Nemotron through OpenRouter. No photos, private file paths, credentials or review notes
            are included. Avoid private personal details. No automatic paid fallback or retries.
          </p>
        </details>
      </form>
    </aside>
  );
}

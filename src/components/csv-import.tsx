"use client";
import { useEffect, useRef, useState } from "react";
import {
  checkCsvColumns,
  checkCsvRows,
  fixtureCsvExample,
  parseCsv,
  teamCsvExample,
} from "@/domain/csv";
import { sizeKeys } from "@/domain/validation";

export function CsvImport({
  kind,
  externalError,
  onClose,
  onImport,
}: {
  kind: "teams" | "fixtures";
  externalError: string;
  onClose: () => void;
  onImport: (op: string, input: unknown) => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const preview = parseCsv(text);
  const errors = [
    ...preview.errors,
    ...checkCsvColumns(kind, preview.headers),
    ...checkCsvRows(kind, preview.rows),
  ];
  async function submit() {
    setBusy(true);
    setError("");
    const rows = preview.rows.map((row) =>
      kind === "teams"
        ? {
            name: row.name,
            code: row.code,
            quantities: Object.fromEntries(
              sizeKeys.map((s) => [s, /^\d+$/.test(row[s] || "") ? Number(row[s]) : -1]),
            ),
          }
        : { label: row.label, teamA: row.team_a, teamB: row.team_b },
    );
    try {
      if (await onImport(kind === "teams" ? "importTeams" : "importFixtures", { rows })) onClose();
      else setError("The import was rejected. Check the workspace message; no rows were saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="csv-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <span className="eyebrow">REVIEW BEFORE SAVING</span>
          <h2 id="csv-title">Import {kind} from CSV</h2>
        </div>
        <button className="icon-button" disabled={busy} aria-label="Close import" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="modal-fields">
        <label className="field">
          <span>Choose a CSV file (optional)</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file && file.size <= 50_000) {
                setText(await file.text());
                setChecked(false);
              } else if (file) setError("Use a CSV smaller than 50 KB.");
            }}
          />
        </label>
        <label className="field">
          <span>CSV contents</span>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setChecked(false);
            }}
            placeholder={kind === "teams" ? teamCsvExample : fixtureCsvExample}
          />
        </label>
        <button className="button secondary" onClick={() => setChecked(true)}>
          Preview rows
        </button>
        {checked && (
          <>
            <p className="form-note">
              {preview.rows.length} rows found. Fixtures use the short codes of teams already saved
              in this event. The whole import is rejected if any row is invalid.
            </p>
            {errors.length ? (
              <ul className="error-message">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              <div className="csv-preview">
                <table>
                  <thead>
                    <tr>
                      {preview.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {preview.headers.map((h) => (
                          <td key={h}>{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {(externalError || error) && (
          <p role="alert" className="error-message">
            {externalError || error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="button"
          disabled={!checked || errors.length > 0 || busy}
          onClick={() => void submit()}
        >
          {busy ? "Importing…" : "Confirm import"}
        </button>
      </div>
    </dialog>
  );
}

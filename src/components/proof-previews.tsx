"use client";
import { useState } from "react";
type Example = {
  id: string;
  name: string;
  reference: string;
  output: string;
  reason: string;
  version: string;
};
export function ProofPreviews({ examples, eventId }: { examples: Example[]; eventId: string }) {
  const [references, setReferences] = useState(true);
  const url = (id: string) =>
    `/api/assets?event=${encodeURIComponent(eventId)}&id=${encodeURIComponent(id)}`;
  return (
    <>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={references}
          onChange={(e) => setReferences(e.target.checked)}
        />
        Show original garment photographs alongside the results
      </label>
      {!references && (
        <p className="proof-boundary">
          Presentation detail: original references and the lower preview edges are hidden to omit
          garment labels. Saved files are unchanged. Inspect full results and references in Preview
          Studio before recording a review.
        </p>
      )}
      <div className="proof-previews">
        {examples.map((p) => (
          <article key={p.id}>
            <h3>{p.name}</h3>
            <div className={`proof-photo-pair ${references ? "" : "results-only"}`}>
              {references && (
                <figure>
                  <img
                    src={url(p.reference)}
                    alt={`${p.name}, original licensed stock garment photograph`}
                  />
                  <figcaption>Original garment reference</figcaption>
                </figure>
              )}
              <figure>
                <img
                  src={url(p.output)}
                  alt={`${p.name}, actual saved YouCam on-person appearance preview`}
                />
                <figcaption>Actual YouCam {p.version} output</figcaption>
              </figure>
            </div>
            <details>
              <summary>Read the saved development acceptance note</summary>
              <p>{p.reason}</p>
            </details>
          </article>
        ))}
      </div>
    </>
  );
}

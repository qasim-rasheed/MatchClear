"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="empty-page">
      <h1>The workspace could not load.</h1>
      <p>Your saved records have not been replaced. Check the local database and try again.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}

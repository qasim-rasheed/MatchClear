export default function NotFound() {
  return (
    <main className="empty-page">
      <span className="eyebrow">MATCHCLEAR</span>
      <h1>This page or event is unavailable.</h1>
      <p>Choose an active event from the workspace, or open the working example.</p>
      <div className="button-row">
        <a className="button" href="/">
          Open workspace
        </a>
        <a className="button secondary" href="/proof">
          See the working example
        </a>
      </div>
    </main>
  );
}

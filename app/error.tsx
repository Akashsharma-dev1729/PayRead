'use client';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container">
      <section className="card" style={{ marginTop: 48 }}>
        <h1>Something went wrong</h1>
        <p className="muted">PayRead hit an unexpected error. You can retry without losing your browser access tokens.</p>
        <button className="btn" onClick={reset}>Try again</button>
        <a className="btn secondary" href="/" style={{ marginLeft: 8 }}>Home</a>
      </section>
    </main>
  );
}

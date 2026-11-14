'use client';

import React, { useEffect, useState } from 'react';
import SiteHeader from '@/components/ui/SiteHeader';
import { useAuth } from '@/lib/auth/use-auth';
import { AccountService } from '@/lib/auth/account-service';
import { percent, StatsError, StatsService, type StatsReport } from '@/lib/analytics/stats-service';
import { formatPrice } from '@/lib/payment';

const RANGES = [7, 30, 90] as const;
const number = (n: number) => n.toLocaleString('en-IN');
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="stat-tile">
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {hint && <div className="stat-hint">{hint}</div>}
  </div>;
}

export default function StatsPage() {
  const auth = useAuth();
  const userId = auth.session?.user?.id ?? null;
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<StatsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!userId) { setAdmin(null); return; }
    let alive = true;
    AccountService.shared().profile()
      .then((p) => { if (alive) setAdmin(p?.isAdmin === true); })
      .catch(() => { if (alive) setAdmin(false); });
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    if (!admin) return;
    let alive = true;
    setLoading(true); setError('');
    StatsService.shared().report(days)
      .then((r) => { if (alive) setReport(r); })
      .catch((e) => { if (alive) setError(e instanceof StatsError ? e.message : 'Could not load stats.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [admin, days, reload]);

  if (auth.loading || (userId && admin === null)) return <main className="container"><p className="muted">Loading…</p></main>;

  if (!auth.session || !admin) {
    return <main className="container">
      <SiteHeader session={auth.session} loading={false} />
      <section className="card auth-wrap">
        <h1 style={{ marginTop: 0 }}>Stats</h1>
        {!auth.session
          ? <><p className="muted">Sign in with your admin account to see site stats.</p>
            <a className="btn" href="/login?next=%2Fadmin%2Fstats">Sign in</a></>
          : <p className="muted">Only PayRead admins can see stats.</p>}
      </section>
    </main>;
  }

  const r = report;
  const funnel = r ? [
    { label: 'Visited the site', value: r.funnel.visited },
    { label: 'Opened an article', value: r.funnel.opened_article },
    { label: 'Started checkout', value: r.funnel.started_checkout },
    { label: 'Submitted a UPI ID', value: r.funnel.submitted_upi },
    { label: 'Paid (approved)', value: r.funnel.paid },
  ] : [];
  const maxDaily = r ? Math.max(1, ...r.daily.map((d) => d.sessions)) : 1;

  return <main className="container stats">
    <SiteHeader session={auth.session} loading={false} />
    <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 'clamp(36px, 5vw, 56px)' }}>Stats</h1>
        <p className="muted small" style={{ margin: '6px 0 0' }}>Anonymous visits and the purchase funnel. Days are India time.</p>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="tabs" role="group" aria-label="Date range" style={{ margin: 0 }}>
          {RANGES.map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>Last {d} days</button>)}
        </div>
        <button className="btn ghost" type="button" onClick={() => setReload((x) => x + 1)} disabled={loading}>Refresh</button>
        <a className="btn ghost" href="/admin">Payments</a>
      </div>
    </div>

    {error && <p className="danger" role="alert">{error}</p>}
    {loading && !r && <p className="muted">Loading stats…</p>}

    {r && <div aria-busy={loading}>
      <section className="stat-grid" aria-label="Summary">
        <Tile label="Visits" value={number(r.sessions)} hint={`${number(r.page_views)} page views`} />
        <Tile label="Sign-ups" value={number(r.signups)} hint={`${number(r.all_time.accounts)} accounts in total`} />
        <Tile label="Purchases" value={number(r.purchases)} hint={`${number(r.all_time.purchases)} all time`} />
        <Tile label="Revenue" value={formatPrice(r.revenue_paise)} hint={`${formatPrice(r.all_time.revenue_paise)} all time`} />
        <Tile label="Waiting for review" value={number(r.awaiting_review)} hint={r.awaiting_review ? 'Approve on the Payments page' : 'Nothing to approve'} />
      </section>

      <section className="card stat-card" aria-labelledby="funnel-title">
        <h2 id="funnel-title">Purchase funnel</h2>
        <p className="muted small">How far visits got. Each step shows its share of the step before.</p>
        <ol className="funnel">
          {funnel.map((step, i) => {
            const width = r.funnel.visited ? Math.max(step.value ? 2 : 0, (step.value / r.funnel.visited) * 100) : 0;
            const share = i === 0 ? null : percent(step.value, funnel[i - 1].value);
            return <li key={step.label}>
              <div className="funnel-head">
                <span>{step.label}</span>
                <span><strong>{number(step.value)}</strong>{share !== null && <span className="muted small"> · {share}%</span>}</span>
              </div>
              <div className="funnel-track" aria-hidden="true"><div className="funnel-bar" style={{ width: `${width}%` }} /></div>
            </li>;
          })}
        </ol>
      </section>

      <section className="card stat-card" aria-labelledby="daily-title">
        <h2 id="daily-title">Visits per day</h2>
        <div className="daily-chart" role="img" aria-label={`Visits per day over the last ${r.days} days, peak ${maxDaily}`}>
          {r.daily.map((d) => <div key={d.day} className="daily-col" tabIndex={0}
            title={`${dayLabel(d.day)}: ${d.sessions} visits, ${d.page_views} page views, ${d.purchases} purchases`}>
            <div className="daily-bar" style={{ height: `${(d.sessions / maxDaily) * 100}%` }} />
            <span className="daily-tip">{dayLabel(d.day)}<br />{d.sessions} visits · {d.purchases} paid</span>
          </div>)}
        </div>
        <div className="daily-axis muted small" aria-hidden="true">
          <span>{r.daily[0] && dayLabel(r.daily[0].day)}</span><span>peak {maxDaily}</span><span>{r.daily.at(-1) && dayLabel(r.daily.at(-1)!.day)}</span>
        </div>
        <details className="small"><summary>Show as a table</summary>
          <div className="table-scroll"><table className="table">
            <thead><tr><th>Day</th><th>Visits</th><th>Page views</th><th>Purchases</th></tr></thead>
            <tbody>{[...r.daily].reverse().map((d) => <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{d.sessions}</td><td>{d.page_views}</td><td>{d.purchases}</td></tr>)}</tbody>
          </table></div>
        </details>
      </section>

      <div className="account-grid">
        <section className="card stat-card" aria-labelledby="sources-title">
          <h2 id="sources-title">Where visits came from</h2>
          {r.top_sources.length === 0 ? <p className="muted">No visits yet in this range.</p> :
            <div className="table-scroll"><table className="table">
              <thead><tr><th>Source</th><th>Visits</th><th>Checkouts</th><th>UPI IDs</th></tr></thead>
              <tbody>{r.top_sources.map((s) => <tr key={s.source}><td>{s.source}</td><td>{s.sessions}</td><td>{s.checkouts}</td><td>{s.upi_submitted}</td></tr>)}</tbody>
            </table></div>}
          <p className="muted small">“direct” means typed in, bookmarked, or from an app that hides where it came from (WhatsApp often does). Use tracking links to see those.</p>
        </section>

        <section className="card stat-card" aria-labelledby="articles-title">
          <h2 id="articles-title">Articles</h2>
          <div className="table-scroll"><table className="table">
            <thead><tr><th>Article</th><th>Opened</th><th>Checkouts</th><th>Sold</th></tr></thead>
            <tbody>{r.top_articles.map((a) => <tr key={a.id}>
              <td><a href={`/article/${a.id}`}>{a.title}</a><div className="muted small">{a.price_paise ? formatPrice(a.price_paise) : 'Free'}</div></td>
              <td>{a.opened}</td><td>{a.price_paise ? a.checkouts : '—'}</td><td>{a.price_paise ? a.purchases : '—'}</td>
            </tr>)}</tbody>
          </table></div>
        </section>
      </div>

      <p className="muted small" style={{ marginTop: 24 }}>
        Devices: {Object.entries(r.devices).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet'}.
        For countries and full traffic detail, open Vercel → pay-read.1 → Analytics.
      </p>
    </div>}
  </main>;
}

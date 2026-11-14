-- Tracking (anonymous funnel events + admin stats). Existing deployments: run
-- this entire file in the Supabase SQL Editor. Re-runnable and additive: no
-- existing table or function is changed.
--
-- Privacy: no names, emails, account ids, IP addresses or cookies. A session is
-- a random id that lives only in one browser tab session (sessionStorage).
begin;

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id uuid not null,
  name text not null check (name in ('page_view', 'article_read', 'paywall_view', 'checkout_open', 'upi_submitted')),
  path text check (char_length(path) <= 200),
  article_id uuid,
  source text check (char_length(source) <= 60),
  medium text check (char_length(medium) <= 60),
  campaign text check (char_length(campaign) <= 60),
  device text check (device in ('mobile', 'tablet', 'desktop'))
);
create index if not exists analytics_events_created_idx on public.analytics_events (created_at);
create index if not exists analytics_events_session_idx on public.analytics_events (session_id, created_at);
create index if not exists analytics_events_article_idx on public.analytics_events (article_id, created_at) where article_id is not null;

-- Nobody reads or writes the table directly; only the two functions below.
alter table public.analytics_events enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'analytics_events'
  loop execute format('drop policy %I on public.analytics_events', r.policyname); end loop;
end $$;
revoke all on table public.analytics_events from public, anon, authenticated;

-- Records one event. Never raises for bad input (tracking must not break the
-- site): unknown names are dropped, text is cleaned and cut, unknown articles
-- are stored without an article. Light abuse limits: 120 events per session per
-- 10 minutes, and 20,000 events per hour overall.
create or replace function public.track_event(
  p_session uuid, p_name text, p_path text default null, p_article uuid default null,
  p_source text default null, p_medium text default null, p_campaign text default null, p_device text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_article uuid;
  clean_tag text;
begin
  if p_session is null or p_name is null
     or p_name not in ('page_view', 'article_read', 'paywall_view', 'checkout_open', 'upi_submitted') then
    return;
  end if;
  if (select count(*) from public.analytics_events
      where session_id = p_session and created_at > now() - interval '10 minutes') >= 120 then
    return;
  end if;
  if (select count(*) from public.analytics_events where created_at > now() - interval '1 hour') >= 20000 then
    return;
  end if;
  select a.id into v_article from public.articles a where a.id = p_article;
  insert into public.analytics_events (session_id, name, path, article_id, source, medium, campaign, device)
  values (
    p_session,
    p_name,
    case when p_path like '/%' then left(regexp_replace(p_path, '[[:cntrl:]]', '', 'g'), 200) end,
    v_article,
    nullif(left(regexp_replace(lower(btrim(coalesce(p_source, ''))), '[^a-z0-9._ -]', '', 'g'), 60), ''),
    nullif(left(regexp_replace(lower(btrim(coalesce(p_medium, ''))), '[^a-z0-9._ -]', '', 'g'), 60), ''),
    nullif(left(regexp_replace(lower(btrim(coalesce(p_campaign, ''))), '[^a-z0-9._ -]', '', 'g'), 60), ''),
    case when p_device in ('mobile', 'tablet', 'desktop') then p_device end
  );
end $$;
revoke all on function public.track_event(uuid, text, text, uuid, text, text, text, text) from public;
grant execute on function public.track_event(uuid, text, text, uuid, text, text, text, text) to anon, authenticated;

-- Everything the stats page shows, for the last p_days days (India time for days).
create or replace function public.admin_stats(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz;
  tz constant text := 'Asia/Kolkata';
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'Choose between 1 and 365 days' using errcode = '22023'; end if;
  since := date_trunc('day', now() at time zone tz) at time zone tz - make_interval(days => p_days - 1);

  return jsonb_build_object(
    'days', p_days,
    'since', since,
    'sessions', (select count(distinct session_id) from public.analytics_events where created_at >= since),
    'page_views', (select count(*) from public.analytics_events where created_at >= since and name = 'page_view'),
    'signups', (select count(*) from public.profiles where created_at >= since),
    'purchases', (select count(*) from public.payments where status = 'completed' and completed_at >= since),
    'revenue_paise', (select coalesce(sum(amount_paise), 0) from public.payments where status = 'completed' and completed_at >= since),
    'awaiting_review', (select count(*) from public.payments where status = 'pending' and provider = 'manual_upi' and payer_utr is not null),
    'all_time', jsonb_build_object(
      'accounts', (select count(*) from public.profiles),
      'purchases', (select count(*) from public.payments where status = 'completed'),
      'revenue_paise', (select coalesce(sum(amount_paise), 0) from public.payments where status = 'completed')),
    'funnel', jsonb_build_object(
      'visited', (select count(distinct session_id) from public.analytics_events where created_at >= since),
      'opened_article', (select count(distinct session_id) from public.analytics_events where created_at >= since
        and name in ('article_read', 'paywall_view', 'checkout_open')),
      'started_checkout', (select count(distinct session_id) from public.analytics_events where created_at >= since and name = 'checkout_open'),
      'submitted_upi', (select count(distinct session_id) from public.analytics_events where created_at >= since and name = 'upi_submitted'),
      'paid', (select count(*) from public.payments where status = 'completed' and completed_at >= since)),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'sessions', d.sessions, 'page_views', d.views, 'purchases', d.paid) order by d.day), '[]'::jsonb)
      from (
        select g.day::date as day,
          (select count(distinct e.session_id) from public.analytics_events e
            where (e.created_at at time zone tz)::date = g.day::date) as sessions,
          (select count(*) from public.analytics_events e
            where e.name = 'page_view' and (e.created_at at time zone tz)::date = g.day::date) as views,
          (select count(*) from public.payments p
            where p.status = 'completed' and (p.completed_at at time zone tz)::date = g.day::date) as paid
        from generate_series((since at time zone tz)::date, (now() at time zone tz)::date, interval '1 day') g(day)
      ) d),
    'top_articles', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.opened desc, t.purchases desc, t.title), '[]'::jsonb)
      from (
        select a.id, a.title, a.price_paise,
          (select count(distinct e.session_id) from public.analytics_events e
            where e.article_id = a.id and e.created_at >= since and e.name in ('article_read', 'paywall_view', 'checkout_open')) as opened,
          (select count(distinct e.session_id) from public.analytics_events e
            where e.article_id = a.id and e.created_at >= since and e.name = 'checkout_open') as checkouts,
          (select count(*) from public.payments p
            where p.article_id = a.id and p.status = 'completed' and p.completed_at >= since) as purchases
        from public.articles a where a.published = true
        order by 4 desc, 6 desc, a.title
        limit 10
      ) t),
    'top_sources', (
      select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.sessions desc, s.source), '[]'::jsonb)
      from (
        select x.source, count(*) as sessions,
          count(*) filter (where x.checkout) as checkouts,
          count(*) filter (where x.upi) as upi_submitted
        from (
          select session_id, coalesce(max(source), 'direct') as source,
            bool_or(name = 'checkout_open') as checkout, bool_or(name = 'upi_submitted') as upi
          from public.analytics_events where created_at >= since group by session_id
        ) x
        group by x.source
        order by 2 desc, 1
        limit 10
      ) s),
    'devices', (
      select coalesce(jsonb_object_agg(d.device, d.sessions), '{}'::jsonb)
      from (
        select coalesce(y.device, 'unknown') as device, count(*) as sessions
        from (select session_id, max(device) as device from public.analytics_events
              where created_at >= since group by session_id) y
        group by 1
      ) d)
  );
end $$;
revoke all on function public.admin_stats(integer) from public, anon;
grant execute on function public.admin_stats(integer) to authenticated;

notify pgrst, 'reload schema';
commit;

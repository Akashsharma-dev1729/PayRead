begin;
-- PayRead Supabase schema
-- Safe for fresh installs and designed around Vercel + browser Supabase clients.

create extension if not exists pgcrypto;

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  excerpt text not null default '',
  content text not null,
  price_paise integer not null check (price_paise >= 0),
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  amount_paise integer not null check (amount_paise > 0),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  transaction_ref text not null unique,
  access_token uuid not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  payer_utr text,
  claimed_at timestamptz
);

-- Upgrade older starter schemas without dropping purchase data.
alter table public.articles add column if not exists excerpt text not null default '';
alter table public.articles add column if not exists published boolean not null default false;
alter table public.articles add column if not exists created_at timestamptz not null default now();
alter table public.payments add column if not exists completed_at timestamptz;
-- Manual UPI: the buyer's 12-digit UPI transaction ID (UTR), the only identifier
-- that appears in the payee's bank/UPI history, and when the buyer submitted it.
alter table public.payments add column if not exists payer_utr text;
alter table public.payments add column if not exists claimed_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_payer_utr_format') then
    alter table public.payments add constraint payments_payer_utr_format
      check (payer_utr is null or payer_utr ~ '^[0-9]{12}$');
  end if;
end $$;

-- Admins are explicit. Authentication alone never grants admin privileges.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.articles enable row level security;
alter table public.payments enable row level security;
alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
  );
$$;

-- These three tables belong to PayRead. Replace ALL legacy policies: permissive
-- policies are ORed, so leaving an older differently-named policy is unsafe.
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('articles','payments','admin_users')
  loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
end $$;

create policy "admin manage articles"
on public.articles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "admin read payments"
on public.payments
for select
to authenticated
using (public.is_admin());

create policy "admin update payments"
on public.payments
for update
to authenticated
using (public.is_admin())
with check (
  public.is_admin()
  and status in ('pending', 'completed', 'failed')
);

-- Public readers never select article rows directly, because that would expose
-- the paid article content. These RPCs return only the fields each flow needs.
create or replace function public.list_published_articles()
returns table (
  id uuid,
  title text,
  excerpt text,
  price_paise integer,
  published boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.title, a.excerpt, a.price_paise, a.published, a.created_at
  from public.articles a
  where a.published = true
  order by a.created_at desc;
$$;

create or replace function public.get_article_preview(p_article_id uuid)
returns table (
  id uuid,
  title text,
  excerpt text,
  price_paise integer,
  published boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.title, a.excerpt, a.price_paise, a.published, a.created_at
  from public.articles a
  where a.id = p_article_id
    and a.published = true
  limit 1;
$$;

-- The browser supplies only identifiers/tokens. The trusted database derives
-- the amount from the article row, so a modified browser cannot choose a price.
create or replace function public.create_payment(
  p_article_id uuid,
  p_transaction_ref text,
  p_access_token uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price integer;
  v_payment_id uuid;
  v_existing public.payments%rowtype;
begin
  if p_access_token is null or p_transaction_ref is null or p_transaction_ref !~ '^PR[0-9A-Z]{8,62}$' then
    raise exception 'Invalid transaction reference';
  end if;

  -- Serialise retries for a given bearer token, including concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended(p_access_token::text, 0));
  select * into v_existing from public.payments where access_token = p_access_token;
  if found then
    if v_existing.article_id <> p_article_id or v_existing.transaction_ref <> p_transaction_ref then
      raise exception 'Payment identity conflict';
    end if;
    return v_existing.id;
  end if;

  select a.price_paise
    into v_price
  from public.articles a
  where a.id = p_article_id
    and a.published = true;

  if v_price is null or v_price <= 0 then
    raise exception 'Article is not available for purchase';
  end if;

  insert into public.payments (
    article_id,
    amount_paise,
    status,
    transaction_ref,
    access_token
  ) values (
    p_article_id,
    v_price,
    'pending',
    p_transaction_ref,
    p_access_token
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

-- Possession of the random access token allows checking only that payment's
-- status; it does not expose the payments table or other tokens.
create or replace function public.get_payment_status(p_access_token uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.status
  from public.payments p
  where p.access_token = p_access_token
  limit 1;
$$;

-- Published free content needs no token. Paid content requires a completed
-- payment for this exact article.
create or replace function public.get_article_content(
  p_article_id uuid,
  p_access_token uuid
)
returns table (
  id uuid,
  title text,
  excerpt text,
  content text,
  price_paise integer,
  published boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.title, a.excerpt, a.content, a.price_paise, a.published, a.created_at
  from public.articles a
  where a.id = p_article_id
    and a.published = true
    and (a.price_paise = 0 or exists (
      select 1
      from public.payments p
      where p.article_id = a.id
        and p.access_token = p_access_token
        and p.status = 'completed'
    ))
  limit 1;
$$;

-- Lock down direct table access. Admin table access remains governed by RLS.
revoke all on table public.articles from public, anon, authenticated;
revoke all on table public.payments from public, anon, authenticated;
revoke all on table public.admin_users from public, anon, authenticated;

-- Table-level REVOKE alone does not remove old column-level grants.
do $$ declare r record; begin
 for r in select table_name, string_agg(quote_ident(column_name), ',') as cols
 from information_schema.columns where table_schema='public'
 and table_name in ('articles','payments','admin_users') group by table_name
 loop execute format('revoke all (%s) on public.%I from public, anon, authenticated', r.cols, r.table_name); end loop;
end $$;

grant select, insert, update, delete on table public.articles to authenticated;
grant select on table public.payments to authenticated;
-- Payment changes are available only through review_payment below.

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- blanket permission, then grant only the roles each browser flow needs.
revoke execute on function public.list_published_articles() from public;
revoke execute on function public.get_article_preview(uuid) from public;
revoke execute on function public.create_payment(uuid, text, uuid) from public;
revoke execute on function public.get_payment_status(uuid) from public;
revoke execute on function public.get_article_content(uuid, uuid) from public;
revoke execute on function public.is_admin() from public;

grant execute on function public.list_published_articles() to anon, authenticated;
grant execute on function public.get_article_preview(uuid) to anon, authenticated;
grant execute on function public.create_payment(uuid, text, uuid) to anon, authenticated;
grant execute on function public.get_payment_status(uuid) to anon, authenticated;
grant execute on function public.get_article_content(uuid, uuid) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;


-- Return type gained payer_utr/claimed_at; a changed return type needs a drop.
drop function if exists public.get_payment_details(uuid);
create function public.get_payment_details(p_access_token uuid)
returns table(article_id uuid, amount_paise integer, transaction_ref text, status text, payer_utr text, claimed_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select p.article_id, p.amount_paise, p.transaction_ref, p.status, p.payer_utr, p.claimed_at from public.payments p
 where p.access_token = p_access_token limit 1;
$$;

create or replace function public.review_payment(p_payment_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
 if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
 if p_status is null or p_status not in ('completed','failed') then raise exception 'Invalid review status'; end if;
 update public.payments set status = p_status,
   completed_at = case when p_status = 'completed' then now() else null end
 where id = p_payment_id and status = 'pending';
 get diagnostics changed = row_count;
 return changed = 1;
end;
$$;
revoke all on function public.get_payment_details(uuid) from public;
revoke all on function public.review_payment(uuid,text) from public, anon;
grant execute on function public.get_payment_details(uuid) to anon, authenticated;
grant execute on function public.review_payment(uuid,text) to authenticated;
create index if not exists payments_pending_created_idx on public.payments(created_at desc) where status = 'pending';
notify pgrst, 'reload schema';
commit;
-- Add your admin Auth user explicitly via the README instructions.

-- Razorpay extension (also available as a separate upgrade migration).
begin;
alter table public.payments add column if not exists provider text not null default 'manual_upi'
 check(provider in ('manual_upi','razorpay'));
create table if not exists public.razorpay_orders (
 payment_id uuid primary key references public.payments(id) on delete cascade,
 order_id text unique,
 captured_payment_id text unique,
 key_id text not null,
 created_at timestamptz not null default now()
);
alter table public.razorpay_orders enable row level security;
revoke all on public.razorpay_orders from public, anon, authenticated;
grant select, update on public.razorpay_orders to service_role;
grant select on public.payments to service_role;

-- One durable reservation per purchase. Never create a second payable order
-- after an ambiguous provider timeout: reconcile the reservation first.
create or replace function public.begin_razorpay_payment(
 p_article_id uuid,p_transaction_ref text,p_access_token uuid,p_key_id text
) returns table(payment_id uuid,amount_paise integer,status text,order_id text,key_id text,claimed boolean)
language plpgsql security definer set search_path='' as $$
declare pid uuid; n integer;
begin
 if p_key_id is null or p_key_id !~ '^rzp_(test|live)_[A-Za-z0-9]+$' then raise exception 'Invalid gateway key ID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_access_token::text,0));
 if exists(select 1 from public.payments p where p.access_token=p_access_token and p.provider <> 'razorpay') then
  raise exception 'This purchase already uses manual UPI';
 end if;
 pid := public.create_payment(p_article_id,p_transaction_ref,p_access_token);
 update public.payments set provider='razorpay' where id=pid;
 insert into public.razorpay_orders(payment_id,key_id) values(pid,p_key_id) on conflict do nothing;
 get diagnostics n=row_count;
 return query select p.id,p.amount_paise,p.status,r.order_id,r.key_id,n=1
 from public.payments p join public.razorpay_orders r on r.payment_id=p.id where p.id=pid;
end $$;

create or replace function public.complete_razorpay_payment(
 p_order_id text,p_payment_id text,p_amount integer,p_currency text
) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.razorpay_orders%rowtype; p public.payments%rowtype;
begin
 select * into r from public.razorpay_orders where order_id=p_order_id for update;
 if not found then raise exception 'Unknown gateway order'; end if;
 select * into p from public.payments where id=r.payment_id for update;
 if p_amount is distinct from p.amount_paise or p_currency is distinct from 'INR'
 or p_payment_id is null or p_payment_id !~ '^pay_[A-Za-z0-9]+$' or p.provider <> 'razorpay' then
  raise exception 'Payment does not match purchase';
 end if;
 if p.status='failed' then raise exception 'Purchase has been revoked'; end if;
 if r.captured_payment_id is not null and r.captured_payment_id <> p_payment_id then raise exception 'Different payment already recorded'; end if;
 update public.razorpay_orders set captured_payment_id=p_payment_id where payment_id=p.id;
 update public.payments set status='completed',completed_at=coalesce(completed_at,now()) where id=p.id;
 return true;
end $$;

create or replace function public.revoke_razorpay_payment(p_order_id text,p_payment_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.razorpay_orders%rowtype;
begin
 select * into r from public.razorpay_orders where order_id=p_order_id for update;
 if not found then return false; end if;
 if r.captured_payment_id is not null and r.captured_payment_id <> p_payment_id then raise exception 'Payment mismatch'; end if;
 update public.razorpay_orders set captured_payment_id=p_payment_id where payment_id=r.payment_id;
 update public.payments set status='failed' where id=r.payment_id and provider='razorpay';
 return true;
end $$;

-- Manual approval must never override an unverified gateway payment, and a
-- manual UPI payment can be approved only once the buyer has submitted the UTR
-- the administrator matches against their bank/UPI history.
create or replace function public.review_payment(p_payment_id uuid,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if not public.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('completed','failed') then raise exception 'Invalid review status'; end if;
 if p_status='completed' and exists(select 1 from public.payments p where p.id=p_payment_id and p.status='pending'
   and p.provider='manual_upi' and p.payer_utr is null) then
  raise exception 'The buyer has not submitted a UPI transaction ID yet';
 end if;
 update public.payments set status=p_status,completed_at=case when p_status='completed' then now() else null end
 where id=p_payment_id and status='pending' and provider='manual_upi';
 get diagnostics changed=row_count; return changed=1;
end $$;

-- One real UPI transfer can back only one live purchase. Rejected claims free
-- their UTR so a squatted or mistyped ID cannot block the genuine payer.
create unique index if not exists payments_payer_utr_live_key
 on public.payments(payer_utr) where payer_utr is not null and status <> 'failed';
create index if not exists payments_manual_claims_idx
 on public.payments(claimed_at) where status='pending' and provider='manual_upi' and payer_utr is not null;

-- The buyer (holder of the bearer token) reports the UTR of the transfer they
-- made. It can be corrected while the payment is still pending.
create or replace function public.submit_payment_utr(p_access_token uuid,p_utr text)
returns text language plpgsql security definer set search_path='' as $$
declare p public.payments%rowtype;
begin
 if p_utr is null or p_utr !~ '^[0-9]{12}$' then
  raise exception 'Enter the 12-digit UPI transaction ID (UTR) shown in your UPI app' using errcode='22023';
 end if;
 select * into p from public.payments where access_token=p_access_token for update;
 if not found or p.provider <> 'manual_upi' then raise exception 'Payment not found' using errcode='P0002'; end if;
 if p.status <> 'pending' then return p.status; end if;
 begin
  update public.payments set payer_utr=p_utr,claimed_at=now() where id=p.id;
 exception when unique_violation then
  raise exception 'This UPI transaction ID is already attached to another purchase' using errcode='23505';
 end;
 return 'pending';
end $$;
revoke all on function public.submit_payment_utr(uuid,text) from public;
grant execute on function public.submit_payment_utr(uuid,text) to anon,authenticated;
revoke all on function public.begin_razorpay_payment(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.complete_razorpay_payment(text,text,integer,text) from public,anon,authenticated;
revoke all on function public.revoke_razorpay_payment(text,text) from public,anon,authenticated;
grant execute on function public.begin_razorpay_payment(uuid,text,uuid,text) to service_role;
grant execute on function public.complete_razorpay_payment(text,text,integer,text) to service_role;
grant execute on function public.revoke_razorpay_payment(text,text) to service_role;
notify pgrst,'reload schema';
commit;

-- Accounts (also available as supabase/migrations/202610210001_accounts.sql).
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  role text not null default 'reader' check (role in ('reader', 'writer')),
  bio text not null default '' check (char_length(bio) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- PayRead owns this table: replace every policy so an older permissive one cannot linger.
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles'
  loop execute format('drop policy %I on public.profiles', r.policyname); end loop;
end $$;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
-- Writes go only through update_my_profile (which cannot touch role).

create or replace function public.profile_display_name(p_user jsonb)
returns text language sql immutable set search_path = '' as $$
  select left(coalesce(
    nullif(btrim(p_user -> 'raw_user_meta_data' ->> 'display_name'), ''),
    nullif(split_part(coalesce(p_user ->> 'email', ''), '@', 1), ''),
    'Reader'), 60);
$$;
revoke all on function public.profile_display_name(jsonb) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, public.profile_display_name(to_jsonb(new)))
  on conflict (id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
create or replace trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select u.id, public.profile_display_name(to_jsonb(u)) from auth.users u
on conflict (id) do nothing;

create or replace function public.get_my_profile()
returns table (display_name text, role text, bio text, is_admin boolean)
language sql stable security definer set search_path = '' as $$
  select p.display_name, p.role, p.bio, public.is_admin()
  from public.profiles p where auth.uid() is not null and p.id = auth.uid();
$$;

create or replace function public.update_my_profile(p_display_name text, p_bio text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_display_name, ''));
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'Name must be 1 to 60 characters' using errcode = '22023';
  end if;
  if p_bio is not null and char_length(p_bio) > 280 then
    raise exception 'Bio must be 280 characters or fewer' using errcode = '22023';
  end if;
  insert into public.profiles (id, display_name, bio) values (auth.uid(), v_name, coalesce(p_bio, ''))
  on conflict (id) do update set display_name = excluded.display_name,
    bio = coalesce(p_bio, public.profiles.bio), updated_at = now();
end $$;

alter table public.payments add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists payments_user_idx on public.payments(user_id) where user_id is not null;

-- Attach browser purchases to the signed-in account. Holding a purchase's random
-- access token is the proof of ownership; an already-owned purchase never moves.
create or replace function public.claim_purchases(p_tokens uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_tokens is null or cardinality(p_tokens) = 0 then return 0; end if;
  if cardinality(p_tokens) > 100 then raise exception 'Too many purchases at once' using errcode = '22023'; end if;
  update public.payments set user_id = auth.uid()
  where access_token = any(p_tokens) and user_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Purchases of the signed-in account. Dialogs that were opened but never paid
-- (pending without a submitted UPI transaction ID) are left out.
create or replace function public.my_purchases()
returns table (payment_id uuid, article_id uuid, article_title text, amount_paise integer,
  status text, provider text, created_at timestamptz, completed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.article_id, a.title, p.amount_paise, p.status, p.provider, p.created_at, p.completed_at
  from public.payments p join public.articles a on a.id = p.article_id
  where auth.uid() is not null and p.user_id = auth.uid()
    and (p.status <> 'pending' or p.payer_utr is not null)
  order by p.created_at desc
  limit 200;
$$;

-- Same signature and result as before; paid content now also opens for the
-- account that owns a completed purchase, on any device.
create or replace function public.get_article_content(p_article_id uuid, p_access_token uuid)
returns table (id uuid, title text, excerpt text, content text, price_paise integer, published boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.title, a.excerpt, a.content, a.price_paise, a.published, a.created_at
  from public.articles a
  where a.id = p_article_id
    and a.published = true
    and (a.price_paise = 0 or exists (
      select 1 from public.payments p
      where p.article_id = a.id and p.status = 'completed'
        and ((p_access_token is not null and p.access_token = p_access_token)
          or (auth.uid() is not null and p.user_id = auth.uid()))
    ))
  limit 1;
$$;

revoke all on function public.get_my_profile() from public, anon;
revoke all on function public.update_my_profile(text, text) from public, anon;
revoke all on function public.claim_purchases(uuid[]) from public, anon;
revoke all on function public.my_purchases() from public, anon;
revoke execute on function public.get_article_content(uuid, uuid) from public;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.update_my_profile(text, text) to authenticated;
grant execute on function public.claim_purchases(uuid[]) to authenticated;
grant execute on function public.my_purchases() to authenticated;
grant execute on function public.get_article_content(uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;

-- Tracking (also available as supabase/migrations/202611140001_tracking.sql).

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

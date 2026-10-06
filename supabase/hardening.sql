begin;
-- PayRead Supabase schema
-- Safe for fresh installs and designed around Vercel + browser Supabase clients.

create extension if not exists pgcrypto;

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  excerpt text not null default '',
  content text not null,
  price_paise integer not null check (price_paise > 0),
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
  completed_at timestamptz
);

-- Upgrade older starter schemas without dropping purchase data.
alter table public.articles add column if not exists excerpt text not null default '';
alter table public.articles add column if not exists published boolean not null default false;
alter table public.articles add column if not exists created_at timestamptz not null default now();
alter table public.payments add column if not exists completed_at timestamptz;

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

-- Paid content is returned only when the supplied token belongs to a completed
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
    and exists (
      select 1
      from public.payments p
      where p.article_id = a.id
        and p.access_token = p_access_token
        and p.status = 'completed'
    )
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


create or replace function public.get_payment_details(p_access_token uuid)
returns table(article_id uuid, amount_paise integer, transaction_ref text, status text)
language sql stable security definer set search_path = '' as $$
 select p.article_id, p.amount_paise, p.transaction_ref, p.status from public.payments p
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

-- Manual approval must never override an unverified gateway payment.
create or replace function public.review_payment(p_payment_id uuid,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if not public.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('completed','failed') then raise exception 'Invalid review status'; end if;
 update public.payments set status=p_status,completed_at=case when p_status='completed' then now() else null end
 where id=p_payment_id and status='pending' and provider='manual_upi';
 get diagnostics changed=row_count; return changed=1;
end $$;
revoke all on function public.begin_razorpay_payment(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.complete_razorpay_payment(text,text,integer,text) from public,anon,authenticated;
revoke all on function public.revoke_razorpay_payment(text,text) from public,anon,authenticated;
grant execute on function public.begin_razorpay_payment(uuid,text,uuid,text) to service_role;
grant execute on function public.complete_razorpay_payment(text,text,integer,text) to service_role;
grant execute on function public.revoke_razorpay_payment(text,text) to service_role;
notify pgrst,'reload schema';
commit;

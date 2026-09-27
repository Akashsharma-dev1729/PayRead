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

-- Remove policies from the older starter that exposed payment/access data or
-- treated every authenticated account as an administrator.
drop policy if exists "public read published articles" on public.articles;
drop policy if exists "public create pending payments" on public.payments;
drop policy if exists "public read own payment status" on public.payments;
drop policy if exists "authenticated admin approve payments" on public.payments;
drop policy if exists "admin manage articles" on public.articles;
drop policy if exists "admin read payments" on public.payments;
drop policy if exists "admin update payments" on public.payments;

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
begin
  if length(trim(p_transaction_ref)) < 8 then
    raise exception 'Invalid transaction reference';
  end if;

  select a.price_paise
    into v_price
  from public.articles a
  where a.id = p_article_id
    and a.published = true;

  if v_price is null then
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
revoke all on table public.articles from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.admin_users from anon, authenticated;

grant select, insert, update, delete on table public.articles to authenticated;
grant select on table public.payments to authenticated;
grant update (status, completed_at) on table public.payments to authenticated;

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

-- Sample content for a fresh database only.
insert into public.articles (title, excerpt, content, price_paise, published)
select
  'The Quiet Power of Deep Work',
  'A short introduction to focused work.',
  'This is a sample paid article. Replace this text with your own article content.\n\nPayRead keeps the reader experience simple: choose an article, pay once, and read after payment confirmation.',
  990,
  true
where not exists (
  select 1 from public.articles where title = 'The Quiet Power of Deep Work'
);

-- IMPORTANT: after creating your admin Auth user, run this once in SQL Editor,
-- replacing the email. Then sign out/in again in the app.
--
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'YOUR_ADMIN_EMAIL'
-- on conflict (user_id) do nothing;

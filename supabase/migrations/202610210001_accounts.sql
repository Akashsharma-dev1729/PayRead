-- Accounts (stage 1). Existing deployments: run this entire file in the Supabase
-- SQL Editor BEFORE deploying the matching frontend. Re-runnable; no existing rows
-- are changed except that every existing Auth user gets a reader profile.
--
-- * profiles: one row per Auth user, created automatically on sign-up.
--   Role (reader/writer) is never editable by the user.
-- * payments.user_id: a purchase can belong to an account, so it opens on any
--   device after sign-in. Browser purchases are attached by proving possession
--   of their access token (claim_purchases).
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

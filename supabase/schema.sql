create extension if not exists pgcrypto;
create table if not exists public.articles (
 id uuid primary key default gen_random_uuid(), title text not null, excerpt text not null default '', content text not null, price_paise integer not null check(price_paise > 0), published boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.payments (
 id uuid primary key default gen_random_uuid(), article_id uuid not null references public.articles(id) on delete cascade, amount_paise integer not null check(amount_paise > 0), status text not null default 'pending' check(status in ('pending','completed','failed')), transaction_ref text not null unique, access_token uuid not null unique, created_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.articles enable row level security;
alter table public.payments enable row level security;
drop policy if exists "public read published articles" on public.articles;
create policy "public read published articles" on public.articles for select using (published = true);
drop policy if exists "public create pending payments" on public.payments;
create policy "public create pending payments" on public.payments for insert with check (status='pending');
drop policy if exists "public read own payment status" on public.payments;
create policy "public read own payment status" on public.payments for select using (true);
drop policy if exists "authenticated admin approve payments" on public.payments;
create policy "authenticated admin approve payments" on public.payments for update to authenticated using (true) with check (status='completed');
insert into public.articles(title,excerpt,content,price_paise,published) values
('The Quiet Power of Deep Work','A short introduction to focused work.','This is a sample paid article. Replace this text with your own article content.

PayRead keeps the reader experience simple: choose an article, pay once, and read after payment confirmation.',990,true)
on conflict do nothing;

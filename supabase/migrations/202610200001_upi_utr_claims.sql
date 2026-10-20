-- Existing deployments: run this entire file in Supabase SQL Editor BEFORE
-- deploying the matching frontend. Re-runnable; existing payments are untouched.
--
-- Manual UPI fix: buyers submit the 12-digit UPI transaction ID (UTR) after
-- paying. Admins review only submitted claims and match the UTR and amount in
-- their bank/UPI app. One UTR can back only one live purchase.
begin;

alter table public.payments add column if not exists payer_utr text;
alter table public.payments add column if not exists claimed_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_payer_utr_format') then
    alter table public.payments add constraint payments_payer_utr_format
      check (payer_utr is null or payer_utr ~ '^[0-9]{12}$');
  end if;
end $$;

create unique index if not exists payments_payer_utr_live_key
 on public.payments(payer_utr) where payer_utr is not null and status <> 'failed';
create index if not exists payments_manual_claims_idx
 on public.payments(claimed_at) where status='pending' and provider='manual_upi' and payer_utr is not null;

-- Return type gained payer_utr/claimed_at; a changed return type needs a drop.
drop function if exists public.get_payment_details(uuid);
create function public.get_payment_details(p_access_token uuid)
returns table(article_id uuid, amount_paise integer, transaction_ref text, status text, payer_utr text, claimed_at timestamptz)
language sql stable security definer set search_path = '' as $$
 select p.article_id, p.amount_paise, p.transaction_ref, p.status, p.payer_utr, p.claimed_at from public.payments p
 where p.access_token = p_access_token limit 1;
$$;
revoke all on function public.get_payment_details(uuid) from public;
grant execute on function public.get_payment_details(uuid) to anon, authenticated;

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
revoke all on function public.review_payment(uuid,text) from public, anon;
grant execute on function public.review_payment(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;

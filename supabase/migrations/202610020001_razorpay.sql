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

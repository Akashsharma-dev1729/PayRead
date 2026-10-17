-- Cover payments.article_id foreign key and article-related payment lookups.
-- This is idempotent and does not modify existing payment records.
create index if not exists payments_article_id_idx on public.payments (article_id);

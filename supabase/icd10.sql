-- Run once in Supabase > SQL Editor. Then import supabase/icd10_codes.csv (see README / instructions).
create extension if not exists pg_trgm;

create table if not exists public.icd10_codes (
  code text primary key,
  description text not null
);
create index if not exists icd10_desc_trgm on public.icd10_codes using gin (description gin_trgm_ops);

alter table public.icd10_codes enable row level security;
drop policy if exists "icd read" on public.icd10_codes;
create policy "icd read" on public.icd10_codes for select
  using (public.my_role() in ('prescriber','dispenser','admin'));

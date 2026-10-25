-- Run once in Supabase > SQL Editor.
-- Adds: patient registration (new "registrar" role), links prescriptions to registered patients.

-- 1) allow the new role
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending','prescriber','dispenser','registrar','admin'));

-- 2) patients
create sequence if not exists public.patient_seq;
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  patient_no text unique not null default ('P' || lpad(nextval('public.patient_seq')::text, 6, '0')),
  full_name text not null,
  age text not null,
  sex text not null check (sex in ('Female','Male')),
  address text,
  phone text,
  payment_method text not null check (payment_method in ('Cash','Insurance')),
  insurance_provider text,
  insurance_number text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists patients_name_idx on public.patients (lower(full_name));

alter table public.patients enable row level security;
drop policy if exists "patients read" on public.patients;
create policy "patients read" on public.patients for select
  using (public.my_role() in ('registrar','prescriber','dispenser','admin'));
drop policy if exists "patients insert" on public.patients;
create policy "patients insert" on public.patients for insert
  with check (public.my_role() in ('registrar','admin'));
drop policy if exists "patients update" on public.patients;
create policy "patients update" on public.patients for update
  using (public.my_role() in ('registrar','admin')) with check (public.my_role() in ('registrar','admin'));

-- 3) prescriptions keep a copy of the patient details
alter table public.prescriptions
  add column if not exists patient_id uuid references public.patients(id),
  add column if not exists patient_no text,
  add column if not exists payment_method text,
  add column if not exists insurance_info text;

-- 4) create_prescription now takes the registered patient's id instead of typed name/age/sex
drop function if exists public.create_prescription(text,text,text,text,text,text,jsonb,text,jsonb,jsonb,jsonb);

create or replace function public.create_prescription(
  p_patient_id uuid,
  p_chief_complaints text, p_hpi text, p_pmh text,
  p_provisional jsonb, p_remarks text, p_investigations jsonb,
  p_diagnoses jsonb, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare rx uuid; it jsonb; m public.medicines; me public.profiles; pt public.patients;
        codes text[]; found int; dx text; prov text; inv text; ids bigint[];
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('prescriber','admin') then raise exception 'Not allowed'; end if;
  select * into pt from public.patients where id = p_patient_id;
  if pt.id is null then raise exception 'Select a registered patient'; end if;
  if coalesce(trim(p_chief_complaints),'') = '' then raise exception 'Chief complaints are required'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'Add at least one medicine'; end if;

  select array_agg(distinct x) into codes from jsonb_array_elements_text(coalesce(p_diagnoses,'[]'::jsonb)) x;
  if codes is null then raise exception 'Add at least one final diagnosis (ICD-10)'; end if;
  select count(*), string_agg(code || ' – ' || description, E'\n' order by code) into found, dx
    from public.icd10_codes where code = any(codes);
  if found <> array_length(codes,1) then raise exception 'Final diagnosis must be chosen from the ICD-10 list'; end if;

  select array_agg(distinct x) into codes from jsonb_array_elements_text(coalesce(p_provisional,'[]'::jsonb)) x;
  if codes is not null then
    select count(*), string_agg(code || ' – ' || description, E'\n' order by code) into found, prov
      from public.icd10_codes where code = any(codes);
    if found <> array_length(codes,1) then raise exception 'Provisional diagnosis must be chosen from the ICD-10 list'; end if;
  end if;

  select array_agg(distinct x::bigint) into ids from jsonb_array_elements_text(coalesce(p_investigations,'[]'::jsonb)) x;
  if ids is not null then
    select count(*), string_agg(type || ': ' || name, E'\n' order by type, name) into found, inv
      from public.investigations where id = any(ids);
    if found <> array_length(ids,1) then raise exception 'Investigations must be chosen from the list'; end if;
  end if;

  insert into public.prescriptions (patient_id, patient_no, patient_name, age, sex, payment_method, insurance_info,
                                    chief_complaints, hpi, pmh, provisional_diagnosis, remarks, investigations, diagnosis,
                                    prescriber_id, prescriber_name)
  values (pt.id, pt.patient_no, pt.full_name, pt.age, pt.sex, pt.payment_method,
          nullif(concat_ws(' · ', pt.insurance_provider, pt.insurance_number), ''),
          p_chief_complaints, p_hpi, p_pmh, prov, p_remarks, inv, dx,
          me.id, coalesce(me.full_name, me.email))
  returning id into rx;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into m from public.medicines where id = (it->>'medicine_id')::bigint;
    insert into public.prescription_items (prescription_id, medicine_id, medicine_name, strength, dose, frequency, duration, quantity)
    values (rx, m.id, m.name, m.strength, it->>'dose', it->>'frequency', it->>'duration',
            coalesce(nullif(it->>'quantity','')::numeric, 1));
  end loop;
  return rx;
end $$;

grant execute on function public.create_prescription(uuid,text,text,text,jsonb,text,jsonb,jsonb,jsonb) to authenticated;

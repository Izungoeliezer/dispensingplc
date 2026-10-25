-- Run once in Supabase > SQL Editor (after lab.sql).
-- Adds: patient queue (visits), saved/editable consultation notes, seen/pending lists, lab result alerts.

-- 1) visits = one consultation episode per patient check-in
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  status text not null default 'waiting' check (status in ('waiting','in_consultation','seen')),
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid default auth.uid() references public.profiles(id),
  doctor_id uuid references public.profiles(id),
  doctor_name text,
  started_at timestamptz,
  completed_at timestamptz,
  chief_complaints text, hpi text, pmh text, remarks text,
  provisional_codes jsonb not null default '[]'::jsonb,
  final_codes jsonb not null default '[]'::jsonb,
  investigation_ids jsonb not null default '[]'::jsonb,
  meds jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists visits_status_idx on public.visits (status, checked_in_at);
create index if not exists visits_patient_idx on public.visits (patient_id);

alter table public.visits enable row level security;
drop policy if exists "visits read" on public.visits;
create policy "visits read" on public.visits for select
  using (public.my_role() in ('registrar','prescriber','admin'));
-- writes only through the functions below

alter table public.prescriptions add column if not exists visit_id uuid references public.visits(id);
alter table public.lab_orders add column if not exists visit_id uuid references public.visits(id);
alter table public.lab_orders add column if not exists result_seen_at timestamptz;

-- 2) reception: put a patient in the doctors' queue
create or replace function public.check_in(p_patient_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if public.my_role() not in ('registrar','admin') then raise exception 'Not allowed'; end if;
  if exists (select 1 from public.visits where patient_id = p_patient_id and status in ('waiting','in_consultation')) then
    raise exception 'This patient is already in the queue';
  end if;
  insert into public.visits (patient_id) values (p_patient_id) returning id into v;
  return v;
end $$;

-- 3) doctor opens a waiting patient
create or replace function public.start_visit(p_visit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('prescriber','admin') then raise exception 'Not allowed'; end if;
  update public.visits set status = 'in_consultation', doctor_id = me.id,
         doctor_name = coalesce(me.full_name, me.email), started_at = now(), updated_at = now()
   where id = p_visit_id and status = 'waiting';
end $$;

-- 4) save notes (draft) or complete the consultation; creates/updates the prescription
drop function if exists public.create_prescription(uuid,text,text,text,jsonb,text,jsonb,jsonb,jsonb);
drop function if exists public.send_to_lab(uuid,jsonb,text);

create or replace function public.save_visit(
  p_visit_id uuid, p_chief_complaints text, p_hpi text, p_pmh text, p_remarks text,
  p_provisional jsonb, p_diagnoses jsonb, p_investigations jsonb, p_items jsonb, p_complete boolean
) returns text
language plpgsql security definer set search_path = public as $$
declare me public.profiles; v public.visits; pt public.patients; rx public.prescriptions;
        it jsonb; m public.medicines; codes text[]; found int; dx text; prov text; inv text; ids bigint[];
        rx_id uuid; msg text := 'Saved';
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('prescriber','admin') then raise exception 'Not allowed'; end if;
  select * into v from public.visits where id = p_visit_id;
  if v.id is null then raise exception 'Visit not found'; end if;
  if v.doctor_id is not null and v.doctor_id <> me.id and me.role <> 'admin' then
    raise exception 'This patient is being attended by %', v.doctor_name;
  end if;
  select * into pt from public.patients where id = v.patient_id;

  -- provisional diagnosis (optional, must be ICD-10)
  codes := array(select distinct x from jsonb_array_elements_text(coalesce(p_provisional,'[]'::jsonb)) x);
  if array_length(codes,1) is not null then
    select count(*), string_agg(code || ' – ' || description, E'\n' order by code) into found, prov
      from public.icd10_codes where code = any(codes);
    if found <> array_length(codes,1) then raise exception 'Provisional diagnosis must be chosen from the ICD-10 list'; end if;
  end if;

  -- final diagnosis (must be ICD-10; required to complete)
  codes := array(select distinct x from jsonb_array_elements_text(coalesce(p_diagnoses,'[]'::jsonb)) x);
  if array_length(codes,1) is not null then
    select count(*), string_agg(code || ' – ' || description, E'\n' order by code) into found, dx
      from public.icd10_codes where code = any(codes);
    if found <> array_length(codes,1) then raise exception 'Final diagnosis must be chosen from the ICD-10 list'; end if;
  end if;

  -- investigations (must come from the list)
  ids := array(select distinct x::bigint from jsonb_array_elements_text(coalesce(p_investigations,'[]'::jsonb)) x);
  if array_length(ids,1) is not null then
    select count(*), string_agg(type || ': ' || name, E'\n' order by type, name) into found, inv
      from public.investigations where id = any(ids);
    if found <> array_length(ids,1) then raise exception 'Investigations must be chosen from the list'; end if;
  end if;

  -- medicines must exist
  for it in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    if not exists (select 1 from public.medicines where id = (it->>'medicine_id')::bigint) then
      raise exception 'Unknown medicine';
    end if;
  end loop;

  if p_complete then
    if coalesce(trim(p_chief_complaints),'') = '' then raise exception 'Chief complaints are required'; end if;
    if dx is null then raise exception 'Add at least one final diagnosis (ICD-10)'; end if;
  end if;

  update public.visits set
    chief_complaints = p_chief_complaints, hpi = p_hpi, pmh = p_pmh, remarks = p_remarks,
    provisional_codes = coalesce(p_provisional,'[]'::jsonb), final_codes = coalesce(p_diagnoses,'[]'::jsonb),
    investigation_ids = coalesce(p_investigations,'[]'::jsonb), meds = coalesce(p_items,'[]'::jsonb),
    doctor_id = coalesce(doctor_id, me.id), doctor_name = coalesce(doctor_name, me.full_name, me.email),
    started_at = coalesce(started_at, now()),
    status = case when p_complete then 'seen' when status = 'waiting' then 'in_consultation' else status end,
    completed_at = case when p_complete then now() else completed_at end,
    updated_at = now()
  where id = v.id;

  if p_complete then
    select * into rx from public.prescriptions where visit_id = v.id order by created_at desc limit 1;
    if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then
      if rx.id is not null and rx.status = 'pending' then delete from public.prescriptions where id = rx.id; end if;
      msg := 'Consultation completed';
    elsif rx.id is not null and rx.status = 'dispensed' then
      msg := 'Notes saved. Medicines were already dispensed, so the prescription was not changed';
    else
      if rx.id is null then
        insert into public.prescriptions (visit_id, patient_id, patient_no, patient_name, age, sex, payment_method, insurance_info,
                                          chief_complaints, hpi, pmh, provisional_diagnosis, remarks, investigations, diagnosis,
                                          prescriber_id, prescriber_name)
        values (v.id, pt.id, pt.patient_no, pt.full_name, pt.age, pt.sex, pt.payment_method,
                nullif(concat_ws(' · ', pt.insurance_provider, pt.insurance_number), ''),
                p_chief_complaints, p_hpi, p_pmh, prov, p_remarks, inv, dx,
                coalesce(v.doctor_id, me.id), coalesce(v.doctor_name, me.full_name, me.email))
        returning id into rx_id;
      else
        rx_id := rx.id;
        update public.prescriptions set chief_complaints = p_chief_complaints, hpi = p_hpi, pmh = p_pmh,
               provisional_diagnosis = prov, remarks = p_remarks, investigations = inv, diagnosis = dx
         where id = rx_id;
        delete from public.prescription_items where prescription_id = rx_id;
      end if;
      for it in select * from jsonb_array_elements(p_items) loop
        select * into m from public.medicines where id = (it->>'medicine_id')::bigint;
        insert into public.prescription_items (prescription_id, medicine_id, medicine_name, strength, dose, frequency, duration, quantity)
        values (rx_id, m.id, m.name, m.strength, it->>'dose', it->>'frequency', it->>'duration',
                coalesce(nullif(it->>'quantity','')::numeric, 1));
      end loop;
      msg := 'Consultation completed and prescription sent to the pharmacy';
    end if;
  end if;
  return msg;
end $$;

-- 5) doctor: send investigations of a visit to the lab
create or replace function public.send_to_lab(p_visit_id uuid, p_investigations jsonb, p_notes text)
returns int
language plpgsql security definer set search_path = public as $$
declare me public.profiles; v public.visits; pt public.patients; ids bigint[]; found int; n int := 0; inv public.investigations;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('prescriber','admin') then raise exception 'Not allowed'; end if;
  select * into v from public.visits where id = p_visit_id;
  if v.id is null then raise exception 'Visit not found'; end if;
  select * into pt from public.patients where id = v.patient_id;
  ids := array(select distinct x::bigint from jsonb_array_elements_text(coalesce(p_investigations,'[]'::jsonb)) x);
  if array_length(ids,1) is null then raise exception 'No investigations selected'; end if;
  select count(*) into found from public.investigations where id = any(ids);
  if found <> array_length(ids,1) then raise exception 'Investigations must be chosen from the list'; end if;
  update public.visits set status = 'in_consultation', doctor_id = coalesce(doctor_id, me.id),
         doctor_name = coalesce(doctor_name, me.full_name, me.email), started_at = coalesce(started_at, now())
   where id = v.id and status = 'waiting';
  for inv in select * from public.investigations where id = any(ids) loop
    if not exists (select 1 from public.lab_orders where visit_id = v.id and investigation_id = inv.id) then
      insert into public.lab_orders (visit_id, patient_id, patient_name, patient_no, age, sex, investigation_id, test_name, test_type,
                                     clinical_notes, requested_by, requested_by_name)
      values (v.id, pt.id, pt.full_name, pt.patient_no, pt.age, pt.sex, inv.id, inv.name, inv.type,
              nullif(trim(p_notes),''), me.id, coalesce(me.full_name, me.email));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 6) doctor: acknowledge lab results (closes the pop-up)
create or replace function public.mark_results_seen(p_ids bigint[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() not in ('prescriber','admin') then raise exception 'Not allowed'; end if;
  update public.lab_orders set result_seen_at = now()
   where id = any(p_ids) and status = 'Completed' and result_seen_at is null
     and (requested_by = auth.uid() or public.my_role() = 'admin');
end $$;

grant execute on function public.check_in(uuid) to authenticated;
grant execute on function public.start_visit(uuid) to authenticated;
grant execute on function public.save_visit(uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,boolean) to authenticated;
grant execute on function public.send_to_lab(uuid,jsonb,text) to authenticated;
grant execute on function public.mark_results_seen(bigint[]) to authenticated;

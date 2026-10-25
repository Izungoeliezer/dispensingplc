-- Run once in Supabase > SQL Editor.
-- Adds: laboratory role, lab orders ("Send to lab"), results entry.

-- 1) allow the new role
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending','prescriber','dispenser','registrar','lab','admin'));

-- 2) lab orders
create table if not exists public.lab_orders (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id),
  patient_name text, patient_no text, age text, sex text,
  investigation_id bigint references public.investigations(id),
  test_name text not null,
  test_type text not null,
  clinical_notes text,
  status text not null default 'Pending' check (status in ('Pending','In progress','Completed')),
  result text,
  requested_by uuid references public.profiles(id),
  requested_by_name text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_by uuid references public.profiles(id),
  completed_by_name text,
  completed_at timestamptz
);
create index if not exists lab_orders_patient_idx on public.lab_orders (patient_id, requested_at desc);
create index if not exists lab_orders_status_idx on public.lab_orders (status);

alter table public.lab_orders enable row level security;
drop policy if exists "lab read" on public.lab_orders;
create policy "lab read" on public.lab_orders for select
  using (public.my_role() in ('lab','prescriber','admin'));
-- writes only through the functions below

-- 3) doctor: send investigations to the lab
create or replace function public.send_to_lab(p_patient_id uuid, p_investigations jsonb, p_notes text)
returns int
language plpgsql security definer set search_path = public as $$
declare me public.profiles; pt public.patients; ids bigint[]; found int; n int := 0; inv public.investigations;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('prescriber','admin') then raise exception 'Not allowed'; end if;
  select * into pt from public.patients where id = p_patient_id;
  if pt.id is null then raise exception 'Select a registered patient'; end if;
  select array_agg(distinct x::bigint) into ids from jsonb_array_elements_text(coalesce(p_investigations,'[]'::jsonb)) x;
  if ids is null then raise exception 'No investigations selected'; end if;
  select count(*) into found from public.investigations where id = any(ids);
  if found <> array_length(ids,1) then raise exception 'Investigations must be chosen from the list'; end if;
  for inv in select * from public.investigations where id = any(ids) loop
    -- skip a test already waiting for this patient
    if not exists (select 1 from public.lab_orders where patient_id = pt.id and investigation_id = inv.id and status <> 'Completed') then
      insert into public.lab_orders (patient_id, patient_name, patient_no, age, sex, investigation_id, test_name, test_type,
                                     clinical_notes, requested_by, requested_by_name)
      values (pt.id, pt.full_name, pt.patient_no, pt.age, pt.sex, inv.id, inv.name, inv.type,
              nullif(trim(p_notes),''), me.id, coalesce(me.full_name, me.email));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- 4) lab: start work / enter result
create or replace function public.lab_start(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() not in ('lab','admin') then raise exception 'Not allowed'; end if;
  update public.lab_orders set status = 'In progress', started_at = now() where id = p_id and status = 'Pending';
end $$;

create or replace function public.lab_complete(p_id bigint, p_result text) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('lab','admin') then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_result),'') = '' then raise exception 'Enter the result'; end if;
  update public.lab_orders set status = 'Completed', result = trim(p_result), completed_by = me.id,
         completed_by_name = coalesce(me.full_name, me.email), completed_at = now(),
         started_at = coalesce(started_at, now())
   where id = p_id and status <> 'Completed';
end $$;

grant execute on function public.send_to_lab(uuid,jsonb,text) to authenticated;
grant execute on function public.lab_start(bigint) to authenticated;
grant execute on function public.lab_complete(bigint,text) to authenticated;

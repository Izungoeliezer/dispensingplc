-- Run this whole file once in Supabase > SQL Editor, THEN run seed_medicines.sql

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'pending' check (role in ('pending','prescriber','dispenser','admin'))
);

create table public.medicines (
  id bigint generated always as identity primary key,
  name text not null,
  strength text not null default '',
  price numeric(12,2) not null default 0,   -- price per unit (TZS)
  active boolean not null default true
);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_name text not null,
  age text,
  sex text,
  history text,
  diagnosis text,
  prescriber_id uuid references public.profiles(id),
  prescriber_name text,
  status text not null default 'pending' check (status in ('pending','dispensed')),
  dispensed_by uuid references public.profiles(id),
  dispensed_by_name text,
  dispensed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.prescription_items (
  id bigint generated always as identity primary key,
  prescription_id uuid not null references public.prescriptions(id) on delete cascade,
  medicine_id bigint not null references public.medicines(id),
  medicine_name text not null,
  strength text,
  dose text,
  frequency text,
  duration text,
  quantity numeric not null default 1,
  unit_price numeric(12,2)      -- filled in at the moment of dispensing
);

-- helper: role of the logged-in user
create or replace function public.my_role() returns text
language sql security definer stable set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

-- auto-create a profile when a user is created (role 'pending' until admin approves)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row level security
alter table public.profiles enable row level security;
alter table public.medicines enable row level security;
alter table public.prescriptions enable row level security;
alter table public.prescription_items enable row level security;

create policy "profile read" on public.profiles for select
  using (id = auth.uid() or public.my_role() = 'admin');
create policy "profile admin update" on public.profiles for update
  using (public.my_role() = 'admin');

create policy "medicines read" on public.medicines for select
  using (public.my_role() in ('prescriber','dispenser','admin'));
create policy "medicines admin write" on public.medicines for all
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy "rx read" on public.prescriptions for select
  using (public.my_role() in ('dispenser','admin')
         or (public.my_role() = 'prescriber' and prescriber_id = auth.uid()));
create policy "items read" on public.prescription_items for select
  using (exists (select 1 from public.prescriptions p where p.id = prescription_id));
-- no direct insert/update policies: writes go through the functions below

create or replace function public.create_prescription(
  p_patient_name text, p_age text, p_sex text, p_history text, p_diagnosis text, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare rx uuid; it jsonb; m public.medicines; me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('prescriber','admin') then raise exception 'Not allowed'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'Add at least one medicine'; end if;
  insert into public.prescriptions (patient_name, age, sex, history, diagnosis, prescriber_id, prescriber_name)
  values (p_patient_name, p_age, p_sex, p_history, p_diagnosis, me.id, coalesce(me.full_name, me.email))
  returning id into rx;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into m from public.medicines where id = (it->>'medicine_id')::bigint;
    insert into public.prescription_items (prescription_id, medicine_id, medicine_name, strength, dose, frequency, duration, quantity)
    values (rx, m.id, m.name, m.strength, it->>'dose', it->>'frequency', it->>'duration',
            coalesce(nullif(it->>'quantity','')::numeric, 1));
  end loop;
  return rx;
end $$;

create or replace function public.dispense_prescription(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('dispenser','admin') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.prescriptions where id = p_id and status = 'pending') then
    raise exception 'Already dispensed or not found';
  end if;
  update public.prescription_items i set unit_price = m.price
    from public.medicines m where m.id = i.medicine_id and i.prescription_id = p_id;
  update public.prescriptions set status = 'dispensed', dispensed_by = me.id,
    dispensed_by_name = coalesce(me.full_name, me.email), dispensed_at = now() where id = p_id;
end $$;

grant execute on function public.create_prescription(text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.dispense_prescription(uuid) to authenticated;

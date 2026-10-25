-- Run once in Supabase > SQL Editor (after icd10.sql and the CSV import).
-- Makes the database itself reject any diagnosis that is not in the ICD-10 list.

drop function if exists public.create_prescription(text,text,text,text,text,jsonb);

create or replace function public.create_prescription(
  p_patient_name text, p_age text, p_sex text, p_history text, p_diagnoses jsonb, p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare rx uuid; it jsonb; m public.medicines; me public.profiles;
        codes text[]; found int; dx text;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('prescriber','admin') then raise exception 'Not allowed'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'Add at least one medicine'; end if;

  select array_agg(distinct x) into codes from jsonb_array_elements_text(coalesce(p_diagnoses,'[]'::jsonb)) x;
  if codes is null then raise exception 'Add at least one ICD-10 diagnosis'; end if;
  select count(*), string_agg(code || ' – ' || description, '; ' order by code) into found, dx
    from public.icd10_codes where code = any(codes);
  if found <> array_length(codes,1) then raise exception 'Diagnosis must be chosen from the ICD-10 list'; end if;

  insert into public.prescriptions (patient_name, age, sex, history, diagnosis, prescriber_id, prescriber_name)
  values (p_patient_name, p_age, p_sex, p_history, dx, me.id, coalesce(me.full_name, me.email))
  returning id into rx;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into m from public.medicines where id = (it->>'medicine_id')::bigint;
    insert into public.prescription_items (prescription_id, medicine_id, medicine_name, strength, dose, frequency, duration, quantity)
    values (rx, m.id, m.name, m.strength, it->>'dose', it->>'frequency', it->>'duration',
            coalesce(nullif(it->>'quantity','')::numeric, 1));
  end loop;
  return rx;
end $$;

grant execute on function public.create_prescription(text,text,text,text,jsonb,jsonb) to authenticated;

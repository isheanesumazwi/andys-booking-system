-- Run after setup.sql, including on existing installations. All edits are transactional.
begin;

alter table public.jobs add column if not exists service_type text not null default '';
alter table public.jobs drop constraint if exists jobs_service_type_check;
alter table public.jobs add constraint jobs_service_type_check check (service_type in (
  '', 'MOT', 'MOT and Service', 'Service', 'Oil and oil filter change',
  'Brake pads, discs and repair', 'Starter Motor replacement', 'Alternator replacement', 'Fault Finder'
));

grant delete on public.jobs to authenticated;
drop policy if exists owner_delete_jobs on public.jobs;
create policy owner_delete_jobs on public.jobs for delete to authenticated
  using (public.is_workshop_admin());

create or replace function public.delete_booking(p_job_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_workshop_admin() then
    raise exception 'Only the workshop owner can delete bookings.';
  end if;
  delete from public.jobs where id = p_job_id;
  if not found then raise exception 'This booking no longer exists.'; end if;
end;
$$;
revoke all on function public.delete_booking(bigint) from public, anon;
grant execute on function public.delete_booking(bigint) to authenticated;

-- Retain the original ten-argument intake API for older deployed clients.
-- Its advisory transaction locks also protect this service-aware overload.
create or replace function public.request_booking(
  p_first_name text, p_last_name text, p_phone text, p_reg_no text,
  p_make text, p_model text, p_year integer, p_engine_capacity text,
  p_booking_date date, p_status text, p_service_type text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_service_type is null or p_service_type not in (
    'MOT', 'MOT and Service', 'Service', 'Oil and oil filter change',
    'Brake pads, discs and repair', 'Starter Motor replacement', 'Alternator replacement', 'Fault Finder'
  ) then
    raise exception 'Please choose a supported service.';
  end if;
  perform public.request_booking(p_first_name, p_last_name, p_phone, p_reg_no,
    p_make, p_model, p_year, p_engine_capacity, p_booking_date, p_status);
  update public.jobs j set service_type = p_service_type
    from public.vehicles v
    where j.vehicle_id = v.id
      and upper(regexp_replace(v.reg_no, '\s', '', 'g')) = upper(regexp_replace(trim(p_reg_no), '\s', '', 'g'))
      and j.booking_date = p_booking_date and j.status <> 'Completed';
  if not found then raise exception 'The booking service could not be saved.'; end if;
end;
$$;
revoke all on function public.request_booking(text,text,text,text,text,text,integer,text,date,text,text) from public;
grant execute on function public.request_booking(text,text,text,text,text,text,integer,text,date,text,text) to anon, authenticated;

create or replace function public.amend_booking(p_job_id bigint, p_details jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job_row public.jobs%rowtype;
  vehicle_row public.vehicles%rowtype;
  first_name_value text := trim(p_details->>'first_name');
  last_name_value text := trim(p_details->>'last_name');
  phone_value text := trim(p_details->>'phone');
  reg_value text := upper(regexp_replace(trim(p_details->>'reg_no'), '\s', '', 'g'));
  make_value text := trim(p_details->>'make');
  model_value text := trim(p_details->>'model');
  year_value integer := (p_details->>'year')::integer;
  date_value date := (p_details->>'booking_date')::date;
  status_value text := p_details->>'status';
  payment_value text := p_details->>'payment_status';
  service_value text := p_details->>'service_type';
begin
  if not public.is_workshop_admin() then
    raise exception 'Only the workshop owner can amend bookings.';
  end if;
  if first_name_value is null or length(first_name_value) not between 1 and 80
    or last_name_value is null or length(last_name_value) not between 1 and 80
    or phone_value is null or phone_value !~ '^\+?[0-9 ()-]{7,25}$'
    or length(regexp_replace(phone_value, '[^0-9]', '', 'g')) < 7
    or reg_value is null or reg_value !~ '^[A-Z0-9]{2,8}$'
    or make_value is null or length(make_value) not between 1 and 100
    or model_value is null or length(model_value) not between 1 and 100
    or date_value is null or (p_details->>'booking_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or status_value is null or status_value not in ('Pending Confirmation', 'Booked', 'In Progress', 'Rescheduled', 'Completed')
    or payment_value is null or payment_value not in ('Unpaid', 'Paid', 'Pay Later')
    or service_value is null or service_value not in (
      '', 'MOT', 'MOT and Service', 'Service', 'Oil and oil filter change',
      'Brake pads, discs and repair', 'Starter Motor replacement', 'Alternator replacement', 'Fault Finder'
    )
    or (p_details->>'amount_due') is null or (p_details->>'amount_due') !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$'
    or (year_value is not null and (year_value < 1886 or year_value > extract(year from now()) + 1))
    or length(coalesce(p_details->>'engine_capacity', '')) > 50
    or length(coalesce(p_details->>'diagnosis_notes', '')) > 10000
    or length(coalesce(p_details->>'parts_ordered', '')) > 10000
  then
    raise exception 'Please check the customer, vehicle and booking details.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reg:' || reg_value, 0));
  select * into job_row from public.jobs where id = p_job_id for update;
  if not found then raise exception 'This booking no longer exists.'; end if;
  select * into vehicle_row from public.vehicles where id = job_row.vehicle_id for update;
  if not found or vehicle_row.customer_id is null then
    raise exception 'The booking has no linked vehicle or customer.';
  end if;
  if exists (select 1 from public.vehicles
    where id <> vehicle_row.id and upper(regexp_replace(reg_no, '\s', '', 'g')) = reg_value)
  then
    raise exception 'That registration belongs to another vehicle. Please check the booking before changing it.';
  end if;
  if status_value <> 'Completed' and exists (
    select 1 from public.jobs where vehicle_id = vehicle_row.id and id <> p_job_id
      and booking_date = date_value and status <> 'Completed'
  ) then
    raise exception 'This vehicle already has a booking on that date.';
  end if;
  update public.customers set first_name = first_name_value, last_name = last_name_value, phone = phone_value
    where id = vehicle_row.customer_id;
  if not found then raise exception 'The linked customer no longer exists.'; end if;
  update public.vehicles set reg_no = reg_value, make = make_value, model = model_value,
    year = year_value, engine_capacity = nullif(trim(p_details->>'engine_capacity'), '')
    where id = vehicle_row.id;
  update public.jobs set booking_date = date_value, status = status_value, service_type = service_value,
    diagnosis_notes = coalesce(p_details->>'diagnosis_notes', ''),
    parts_ordered = coalesce(p_details->>'parts_ordered', ''),
    amount_due = (p_details->>'amount_due')::numeric, payment_status = payment_value
    where id = p_job_id;
end;
$$;
revoke all on function public.amend_booking(bigint,jsonb) from public, anon;
grant execute on function public.amend_booking(bigint,jsonb) to authenticated;

commit;

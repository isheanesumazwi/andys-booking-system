-- Run after setup.sql, booking-updates.sql, job-cards.sql and service-requests.sql.
-- Adds customer addresses, one-hour time slots, Wednesday/Thursday online booking and
-- automatic confirmation of interim, full and major services. All rules are enforced here.
-- The older intake RPCs are withdrawn because they bypass these rules, so deploy the
-- matching frontend straight after running this. Rerun after booking-updates or service-requests.
begin;

alter table public.jobs add column if not exists booking_time time;
alter table public.jobs add column if not exists customer_address text not null default '';
alter table public.jobs add column if not exists customer_postcode text not null default '';
alter table public.jobs drop constraint if exists jobs_booking_time_check;
alter table public.jobs add constraint jobs_booking_time_check check (booking_time is null
  or booking_time in ('10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30'));
alter table public.jobs drop constraint if exists jobs_customer_address_check;
alter table public.jobs add constraint jobs_customer_address_check
  check (length(customer_address) <= 300 and length(customer_postcode) <= 10);

-- One mechanic, so each date and time holds one job. Deleting a booking frees its slot.
create unique index if not exists jobs_booking_slot_idx
  on public.jobs (booking_date, booking_time) where booking_time is not null;

revoke execute on function public.request_booking(text,text,text,text,text,text,integer,text,date,text) from public, anon, authenticated;
revoke execute on function public.request_booking(text,text,text,text,text,text,integer,text,date,text,text) from public, anon, authenticated;

-- Public slot board: dates, times and states only, never customer details.
create or replace function public.get_slot_availability(p_from date, p_to date)
returns table (slot_date date, slot_time text, state text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Please choose a shorter date range.';
  end if;
  return query
    select j.booking_date, to_char(j.booking_time, 'HH24:MI'),
      case when j.status = 'Pending Confirmation' then 'pending' else 'booked' end
    from public.jobs j
    where j.booking_date between p_from and p_to and j.booking_time is not null;
end;
$$;
revoke all on function public.get_slot_availability(date,date) from public;
grant execute on function public.get_slot_availability(date,date) to anon, authenticated;

-- Returns the saved status so the page can say whether the booking is already confirmed.
create or replace function public.create_booking(p_details jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  owner_access boolean := public.is_workshop_admin();
  date_value date := (p_details->>'booking_date')::date;
  time_value time := (p_details->>'booking_time')::time;
  service_value text := trim(p_details->>'service_type');
  address_value text := trim(p_details->>'customer_address');
  postcode_value text := upper(trim(p_details->>'customer_postcode'));
  reg_value text := upper(regexp_replace(trim(p_details->>'reg_no'), '\s', '', 'g'));
  status_value text;
begin
  if date_value is null or time_value is null
    or time_value not in ('10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30')
  then
    raise exception 'Please choose a date and time.';
  end if;
  if not owner_access and extract(isodow from date_value) not in (3, 4) then
    raise exception 'Online bookings are for Wednesdays and Thursdays only.';
  end if;
  if date_value + time_value <= (now() at time zone 'Europe/London') then
    raise exception 'That time has passed. Please choose another.';
  end if;
  if address_value is null or length(address_value) not between 5 and 300
    or postcode_value is null or postcode_value !~ '^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$'
  then
    raise exception 'Please enter your full address and postcode.';
  end if;
  status_value := case when owner_access or lower(service_value) in ('interim service', 'full service', 'major service')
    then 'Booked' else 'Pending Confirmation' end;

  perform pg_advisory_xact_lock(hashtextextended('slot:' || date_value || ' ' || time_value, 0));
  if exists (select 1 from public.jobs where booking_date = date_value and booking_time = time_value) then
    raise exception 'That time has just been taken. Please choose another.';
  end if;
  perform public.request_booking(p_details->>'first_name', p_details->>'last_name', p_details->>'phone',
    p_details->>'reg_no', p_details->>'make', p_details->>'model', (p_details->>'year')::integer,
    nullif(trim(p_details->>'engine_capacity'), ''), date_value, 'Pending Confirmation', service_value);
  update public.jobs j set booking_time = time_value, customer_address = address_value,
      customer_postcode = postcode_value, status = status_value
    from public.vehicles v
    where j.vehicle_id = v.id and upper(regexp_replace(v.reg_no, '\s', '', 'g')) = reg_value
      and j.booking_date = date_value and j.status <> 'Completed';
  if not found then raise exception 'The booking could not be saved.'; end if;
  return status_value;
end;
$$;
revoke all on function public.create_booking(jsonb) from public;
grant execute on function public.create_booking(jsonb) to anon, authenticated;

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
  service_value text := trim(p_details->>'service_type');
  time_value time := nullif(p_details->>'booking_time', '')::time;
  address_value text := coalesce(trim(p_details->>'customer_address'), '');
  postcode_value text := upper(coalesce(trim(p_details->>'customer_postcode'), ''));
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
    or service_value is null or length(service_value) > 200
    or (time_value is not null and time_value not in ('10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30'))
    or length(address_value) > 300 or length(postcode_value) > 10
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
  if time_value is not null then
    perform pg_advisory_xact_lock(hashtextextended('slot:' || date_value || ' ' || time_value, 0));
    if exists (select 1 from public.jobs where id <> p_job_id and booking_date = date_value and booking_time = time_value) then
      raise exception 'Another job already has that date and time.';
    end if;
  end if;
  update public.customers set first_name = first_name_value, last_name = last_name_value, phone = phone_value
    where id = vehicle_row.customer_id;
  if not found then raise exception 'The linked customer no longer exists.'; end if;
  update public.vehicles set reg_no = reg_value, make = make_value, model = model_value,
    year = year_value, engine_capacity = nullif(trim(p_details->>'engine_capacity'), '')
    where id = vehicle_row.id;
  update public.jobs set booking_date = date_value, booking_time = time_value,
    customer_address = address_value, customer_postcode = postcode_value, status = status_value, service_type = service_value,
    diagnosis_notes = coalesce(p_details->>'diagnosis_notes', ''),
    parts_ordered = coalesce(p_details->>'parts_ordered', ''),
    amount_due = (p_details->>'amount_due')::numeric, payment_status = payment_value
    where id = p_job_id;
end;
$$;
revoke all on function public.amend_booking(bigint,jsonb) from public, anon;
grant execute on function public.amend_booking(bigint,jsonb) to authenticated;

commit;

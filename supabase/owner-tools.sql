-- Run after booking-contacts.sql, once the matching site is live. Rerun after it.
-- Adds Cancelled and No-show, opening days, hours and holidays the owner can change,
-- private links customers use to cancel or move a booking, and online booking checks
-- (privacy consent and a daily limit per phone). Online bookings now go through the
-- site's /api/book function, so the public can no longer call create_booking directly.
begin;

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check check (status in
  ('Pending Confirmation', 'Booked', 'In Progress', 'Rescheduled', 'Completed', 'Cancelled', 'No-show'));
alter table public.jobs add column if not exists created_at timestamptz not null default now();
alter table public.jobs add column if not exists consented_at timestamptz;
create index if not exists jobs_created_at_idx on public.jobs(created_at);

-- Times follow the owner's opening hours, so any whole or half hour in the working day is allowed.
alter table public.jobs drop constraint if exists jobs_booking_time_check;
alter table public.jobs add constraint jobs_booking_time_check check (booking_time is null
  or (booking_time between '06:00' and '22:00' and extract(minute from booking_time) in (0, 30)
    and extract(second from booking_time) = 0));

-- A cancelled booking gives its slot back.
drop index if exists public.jobs_booking_slot_idx;
create unique index jobs_booking_slot_idx on public.jobs (booking_date, booking_time)
  where booking_time is not null and status <> 'Cancelled';

-- One row. Slots run hourly from opening time, with the last one starting an hour before closing.
create table if not exists public.workshop_settings (
  id boolean primary key default true check (id),
  open_days integer[] not null default '{3,4}',
  open_time time not null default '10:30',
  close_time time not null default '17:30',
  closed_dates date[] not null default '{}',
  extra_dates date[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.workshop_settings default values on conflict (id) do nothing;
alter table public.workshop_settings enable row level security;
revoke all on public.workshop_settings from anon, authenticated;

create or replace function public.workshop_slot_times()
returns time[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg((s.open_time + make_interval(hours => n))::time order by n), '{}')
  from public.workshop_settings s, generate_series(0, 16) n
  where extract(epoch from s.open_time) + (n + 1) * 3600 <= extract(epoch from s.close_time);
$$;
revoke all on function public.workshop_slot_times() from public, anon, authenticated;

create or replace function public.workshop_open_on(p_date date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_date = any(s.extra_dates)
    or (extract(isodow from p_date)::integer = any(s.open_days) and not p_date = any(s.closed_dates))
  from public.workshop_settings s;
$$;
revoke all on function public.workshop_open_on(date) from public, anon, authenticated;

-- Public: what the booking page needs to show open days and times. Past dates are left out.
create or replace function public.get_booking_settings()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'open_days', to_jsonb(s.open_days),
    'open_time', to_char(s.open_time, 'HH24:MI'),
    'close_time', to_char(s.close_time, 'HH24:MI'),
    'slots', (select coalesce(jsonb_agg(to_char(t, 'HH24:MI') order by t), '[]') from unnest(public.workshop_slot_times()) t),
    'closed_dates', (select coalesce(jsonb_agg(d order by d), '[]') from unnest(s.closed_dates) d
      where d >= (now() at time zone 'Europe/London')::date),
    'extra_dates', (select coalesce(jsonb_agg(d order by d), '[]') from unnest(s.extra_dates) d
      where d >= (now() at time zone 'Europe/London')::date))
  from public.workshop_settings s;
$$;
revoke all on function public.get_booking_settings() from public;
grant execute on function public.get_booking_settings() to anon, authenticated;

create or replace function public.save_booking_settings(p_settings jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  days_value integer[];
  open_value time;
  close_value time;
  closed_value date[];
  extra_value date[];
begin
  if not public.has_permission('admin') then
    raise exception 'You do not have permission to change opening hours.';
  end if;
  begin
    days_value := array(select distinct value::integer from jsonb_array_elements_text(p_settings->'open_days') order by 1);
    open_value := (p_settings->>'open_time')::time;
    close_value := (p_settings->>'close_time')::time;
    closed_value := array(select distinct value::date from jsonb_array_elements_text(coalesce(p_settings->'closed_dates', '[]')) order by 1);
    extra_value := array(select distinct value::date from jsonb_array_elements_text(coalesce(p_settings->'extra_dates', '[]')) order by 1);
  exception when others then
    raise exception 'Please check the opening days, hours and dates.';
  end;
  if not days_value <@ array[1, 2, 3, 4, 5, 6, 7]
    or open_value is null or close_value is null
    or open_value < '06:00' or close_value > '22:00'
    or extract(minute from open_value) not in (0, 30) or extract(minute from close_value) not in (0, 30)
    or close_value < open_value + interval '1 hour'
    or cardinality(closed_value) > 366 or cardinality(extra_value) > 366
  then
    raise exception 'Opening hours must be between 6am and 10pm, on the hour or half hour, and at least an hour long.';
  end if;
  update public.workshop_settings set open_days = days_value, open_time = open_value, close_time = close_value,
    closed_dates = closed_value, extra_dates = extra_value, updated_at = now();
end;
$$;
revoke all on function public.save_booking_settings(jsonb) from public, anon;
grant execute on function public.save_booking_settings(jsonb) to authenticated;

-- Cancelled bookings no longer show as taken.
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
    where j.booking_date between p_from and p_to and j.booking_time is not null and j.status <> 'Cancelled';
end;
$$;
revoke all on function public.get_slot_availability(date,date) from public;
grant execute on function public.get_slot_availability(date,date) to anon, authenticated;

create or replace function public.request_booking(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_reg_no text,
  p_make text,
  p_model text,
  p_year integer,
  p_engine_capacity text,
  p_booking_date date,
  p_status text default 'Pending Confirmation'
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  normalized_reg text := upper(regexp_replace(trim(p_reg_no), '\s', '', 'g'));
  normalized_phone text := right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10);
  customer_key bigint;
  vehicle_key bigint;
  existing_phone text;
  owner_access boolean := public.is_workshop_admin();
begin
  if p_first_name is null or length(trim(p_first_name)) not between 1 and 80
    or p_last_name is null or length(trim(p_last_name)) not between 1 and 80
    or p_phone is null or p_phone !~ '^\+?[0-9 ()-]{7,25}$' or length(normalized_phone) < 7
    or normalized_reg is null or normalized_reg !~ '^[A-Z0-9]{2,8}$'
    or p_make is null or length(trim(p_make)) not between 1 and 100
    or p_model is null or length(trim(p_model)) not between 1 and 100
    or p_booking_date is null or p_booking_date < (now() at time zone 'Europe/London')::date
    or (p_year is not null and (p_year < 1886 or p_year > extract(year from now()) + 1))
    or (p_engine_capacity is not null and length(p_engine_capacity) > 50)
  then
    raise exception 'Please check your contact details, vehicle details and preferred date.';
  end if;
  if p_status is null or p_status not in ('Pending Confirmation', 'Booked')
    or (p_status <> 'Pending Confirmation' and not owner_access)
  then
    raise exception 'You do not have permission to create a confirmed booking.';
  end if;

  -- Serialize matching intakes to prevent duplicate customers or vehicle races.
  perform pg_advisory_xact_lock(hashtextextended('phone:' || normalized_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('reg:' || normalized_reg, 0));

  select v.id, v.customer_id, right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
    into vehicle_key, customer_key, existing_phone
    from public.vehicles v left join public.customers c on c.id = v.customer_id
    where upper(regexp_replace(v.reg_no, '\s', '', 'g')) = normalized_reg
    for update of v;

  if vehicle_key is not null then
    -- Never reassign ownership or reveal stored customer information through public intake.
    if existing_phone is distinct from normalized_phone then
      raise exception 'This request needs a manual review. Please contact the workshop to arrange your booking.';
    end if;
  else
    select id into customer_key from public.customers
      where right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = normalized_phone
        and lower(trim(first_name)) = lower(trim(p_first_name))
        and lower(trim(last_name)) = lower(trim(p_last_name))
      order by id limit 1;
    if customer_key is null then
      insert into public.customers(first_name, last_name, phone)
        values (trim(p_first_name), trim(p_last_name), trim(p_phone))
        returning id into customer_key;
    end if;
    insert into public.vehicles(customer_id, reg_no, make, model, year, engine_capacity)
      values (customer_key, normalized_reg, trim(p_make), trim(p_model), p_year, p_engine_capacity)
      returning id into vehicle_key;
  end if;

  if exists (select 1 from public.jobs where vehicle_id = vehicle_key
    and booking_date = p_booking_date and status not in ('Completed', 'Cancelled', 'No-show'))
  then
    raise exception 'There is already a request or booking for this vehicle on that date. Please contact the workshop for changes.';
  end if;
  insert into public.jobs(vehicle_id, booking_date, status, payment_status, amount_due)
    values (vehicle_key, p_booking_date, p_status, 'Unpaid', 0);
end;
$$;

create or replace function public.create_booking(p_details jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  owner_access boolean := public.has_permission('bookings_manage');
  date_value date := (p_details->>'booking_date')::date;
  time_value time := (p_details->>'booking_time')::time;
  service_value text := trim(p_details->>'service_type');
  address_value text := trim(p_details->>'customer_address');
  postcode_value text := upper(trim(p_details->>'customer_postcode'));
  reg_value text := upper(regexp_replace(trim(p_details->>'reg_no'), '\s', '', 'g'));
  status_value text;
  phone_value text := trim(p_details->>'phone');
  name_value text := trim(trim(p_details->>'first_name') || ' ' || trim(p_details->>'last_name'));
  email_value text := lower(trim(coalesce(p_details->>'email', '')));
  vehicle_key bigint;
  existing_phone text;
  active_job bigint;
  change_request boolean := coalesce((p_details->>'change_request')::boolean, false);
begin
  if date_value is null or time_value is null or time_value <> all(public.workshop_slot_times()) then
    raise exception 'Please choose a date and time.';
  end if;
  if not owner_access and not public.workshop_open_on(date_value) then
    raise exception 'We are not taking online bookings on that day. Please choose another.';
  end if;
  if date_value + time_value <= (now() at time zone 'Europe/London') then
    raise exception 'That time has passed. Please choose another.';
  end if;
  if address_value is null or length(address_value) not between 5 and 300
    or postcode_value is null or postcode_value !~ '^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$'
  then
    raise exception 'Please enter your full address and postcode.';
  end if;
  if (email_value = '' and not owner_access)
    or (email_value <> '' and (length(email_value) > 254 or email_value !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'))
  then
    raise exception 'Please enter a valid email address.';
  end if;
  status_value := case when owner_access or lower(service_value) in ('interim service', 'full service', 'major service')
    then 'Booked' else 'Pending Confirmation' end;

  perform pg_advisory_xact_lock(hashtextextended('slot:' || date_value || ' ' || time_value, 0));
  if exists (select 1 from public.jobs where booking_date = date_value and booking_time = time_value and status <> 'Cancelled') then
    raise exception 'That time has just been taken. Please choose another.';
  end if;
  -- A different phone on a known vehicle may be a family member or a new owner. Their details stay
  -- on this job, and the customer already on file is never changed or revealed.
  perform pg_advisory_xact_lock(hashtextextended('reg:' || reg_value, 0));
  select v.id, right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) into vehicle_key, existing_phone
    from public.vehicles v left join public.customers c on c.id = v.customer_id
    where upper(regexp_replace(v.reg_no, '\s', '', 'g')) = reg_value
    for update of v;
  if vehicle_key is not null and existing_phone is distinct from right(regexp_replace(phone_value, '[^0-9]', '', 'g'), 10) then
    if length(trim(p_details->>'first_name')) not between 1 and 80
      or length(trim(p_details->>'last_name')) not between 1 and 80
      or phone_value is null or phone_value !~ '^\+?[0-9 ()-]{7,25}$'
      or length(regexp_replace(phone_value, '[^0-9]', '', 'g')) < 7
      or service_value is null or length(service_value) not between 1 and 200
    then
      raise exception 'Please check your contact details, vehicle details and preferred date.';
    end if;
    select id into active_job from public.jobs where vehicle_id = vehicle_key and status not in ('Completed', 'Cancelled', 'No-show')
      order by booking_date, id limit 1;
    if active_job is not null and not owner_access then
      if not change_request then return 'Already Booked'; end if;
      status_value := 'Pending Confirmation';
    else
      active_job := null;
      if exists (select 1 from public.jobs where vehicle_id = vehicle_key
        and booking_date = date_value and status not in ('Completed', 'Cancelled', 'No-show'))
      then
        raise exception 'There is already a request or booking for this vehicle on that date. Please contact the workshop for changes.';
      end if;
    end if;
    insert into public.jobs (vehicle_id, booking_date, booking_time, status, payment_status, amount_due, service_type,
      customer_address, customer_postcode, contact_name, contact_phone, contact_email, replaces_job_id)
      values (vehicle_key, date_value, time_value, status_value, 'Unpaid', 0, service_value,
        address_value, postcode_value, name_value, phone_value, email_value, active_job);
    return status_value;
  end if;

  perform public.request_booking(p_details->>'first_name', p_details->>'last_name', p_details->>'phone',
    p_details->>'reg_no', p_details->>'make', p_details->>'model', (p_details->>'year')::integer,
    nullif(trim(p_details->>'engine_capacity'), ''), date_value, 'Pending Confirmation', service_value);
  update public.jobs j set booking_time = time_value, customer_address = address_value,
      customer_postcode = postcode_value, contact_email = email_value, status = status_value
    from public.vehicles v
    where j.vehicle_id = v.id and upper(regexp_replace(v.reg_no, '\s', '', 'g')) = reg_value
      and j.booking_date = date_value and j.status not in ('Completed', 'Cancelled', 'No-show');
  if not found then raise exception 'The booking could not be saved.'; end if;
  return status_value;
end;
$$;
-- Staff book here directly. The public goes through book_online via the site's server.
revoke all on function public.create_booking(jsonb) from public, anon;
grant execute on function public.create_booking(jsonb) to authenticated, service_role;

create or replace function public.amend_booking(p_job_id bigint, p_details jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  manage_access boolean := public.has_permission('bookings_manage');
  payment_access boolean := public.has_permission('payments');
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
  if not manage_access and not payment_access then
    raise exception 'You do not have permission to change this booking.';
  end if;
  if first_name_value is null or length(first_name_value) not between 1 and 80
    or last_name_value is null or length(last_name_value) not between 1 and 80
    or phone_value is null or phone_value !~ '^\+?[0-9 ()-]{7,25}$'
    or length(regexp_replace(phone_value, '[^0-9]', '', 'g')) < 7
    or reg_value is null or reg_value !~ '^[A-Z0-9]{2,8}$'
    or make_value is null or length(make_value) not between 1 and 100
    or model_value is null or length(model_value) not between 1 and 100
    or date_value is null or (p_details->>'booking_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or status_value is null or status_value not in ('Pending Confirmation', 'Booked', 'In Progress', 'Rescheduled', 'Completed', 'Cancelled', 'No-show')
    or payment_value is null or payment_value not in ('Unpaid', 'Paid', 'Pay Later')
    or service_value is null or length(service_value) > 200
    or (time_value is not null and (time_value < '06:00' or time_value > '22:00'))
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
  if not manage_access then
    update public.jobs set amount_due = (p_details->>'amount_due')::numeric, payment_status = payment_value where id = p_job_id;
    return;
  end if;
  select * into vehicle_row from public.vehicles where id = job_row.vehicle_id for update;
  if not found or vehicle_row.customer_id is null then
    raise exception 'The booking has no linked vehicle or customer.';
  end if;
  if exists (select 1 from public.vehicles
    where id <> vehicle_row.id and upper(regexp_replace(reg_no, '\s', '', 'g')) = reg_value)
  then
    raise exception 'That registration belongs to another vehicle. Please check the booking before changing it.';
  end if;
  if status_value not in ('Completed', 'Cancelled', 'No-show') and exists (
    select 1 from public.jobs where vehicle_id = vehicle_row.id and id <> p_job_id
      and booking_date = date_value and status not in ('Completed', 'Cancelled', 'No-show')
  ) then
    raise exception 'This vehicle already has a booking on that date.';
  end if;
  if time_value is not null and status_value <> 'Cancelled' then
    perform pg_advisory_xact_lock(hashtextextended('slot:' || date_value || ' ' || time_value, 0));
    if exists (select 1 from public.jobs where id <> p_job_id and booking_date = date_value and booking_time = time_value and status <> 'Cancelled') then
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
    amount_due = case when payment_access then (p_details->>'amount_due')::numeric else amount_due end,
    payment_status = case when payment_access then payment_value else payment_status end
    where id = p_job_id;
end;
$$;

-- Mechanics can also record a no-show. Cancelling is left to people who manage bookings.
create or replace function public.set_job_status(p_job_id bigint, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not (public.has_permission('job_cards') or public.has_permission('bookings_manage')) then
    raise exception 'You do not have permission to change the job status.';
  end if;
  if p_status is null or p_status not in ('Booked', 'In Progress', 'Rescheduled', 'Completed', 'No-show') then
    raise exception 'Please choose a valid job status.';
  end if;
  update public.jobs set status = p_status where id = p_job_id and status not in ('Pending Confirmation', 'Cancelled');
  if not found then raise exception 'This job is not confirmed yet.'; end if;
end;
$$;
revoke all on function public.set_job_status(bigint,text) from public, anon;
grant execute on function public.set_job_status(bigint,text) to authenticated;

-- Each booking's private link for the customer. Staff never see these.
create table if not exists public.booking_tokens (
  job_id bigint primary key references public.jobs(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
alter table public.booking_tokens enable row level security;
revoke all on public.booking_tokens from anon, authenticated;

create or replace function public.booking_token_for(p_job_id bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  token_value uuid;
begin
  insert into public.booking_tokens(job_id) values (p_job_id) on conflict (job_id) do nothing;
  select token into token_value from public.booking_tokens where job_id = p_job_id;
  return token_value;
end;
$$;
revoke all on function public.booking_token_for(bigint) from public, anon, authenticated;

-- What a customer, or an email about their booking, may show. No other customer details.
create or replace function public.booking_summary(p_job_id bigint)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'job_id', j.id,
    'status', j.status,
    'booking_date', j.booking_date,
    'booking_time', to_char(j.booking_time, 'HH24:MI'),
    'service_type', j.service_type,
    'reg_no', v.reg_no,
    'make', v.make,
    'model', v.model,
    'first_name', coalesce(nullif(split_part(j.contact_name, ' ', 1), ''), c.first_name),
    'email', j.contact_email,
    'can_change', j.status in ('Pending Confirmation', 'Booked', 'Rescheduled')
      and j.booking_time is not null
      and j.booking_date + j.booking_time > (now() at time zone 'Europe/London') + interval '2 hours')
  from public.jobs j
  left join public.vehicles v on v.id = j.vehicle_id
  left join public.customers c on c.id = v.customer_id
  where j.id = p_job_id;
$$;
revoke all on function public.booking_summary(bigint) from public, anon, authenticated;

-- Online bookings, called by the site's server after its spam checks.
create or replace function public.book_online(p_details jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  phone_digits text := right(regexp_replace(coalesce(p_details->>'phone', ''), '[^0-9]', '', 'g'), 10);
  status_value text;
  job_key bigint;
begin
  if coalesce((p_details->>'privacy_accepted')::boolean, false) is not true then
    raise exception 'Please agree to the privacy policy to book.';
  end if;
  if length(phone_digits) >= 7 and (
    select count(*) from public.jobs j
      left join public.vehicles v on v.id = j.vehicle_id
      left join public.customers c on c.id = v.customer_id
      where j.created_at > now() - interval '1 day'
        and right(regexp_replace(coalesce(nullif(j.contact_phone, ''), c.phone, ''), '[^0-9]', '', 'g'), 10) = phone_digits
  ) >= 3 then
    raise exception 'You have made several bookings today. Please call the workshop to book any more.';
  end if;
  status_value := public.create_booking(p_details - 'privacy_accepted');
  if status_value = 'Already Booked' then return jsonb_build_object('status', status_value); end if;
  select id into job_key from public.jobs
    where booking_date = (p_details->>'booking_date')::date and booking_time = (p_details->>'booking_time')::time
      and status <> 'Cancelled';
  update public.jobs set consented_at = now() where id = job_key;
  return public.booking_summary(job_key) || jsonb_build_object('token', public.booking_token_for(job_key));
end;
$$;
revoke all on function public.book_online(jsonb) from public, anon, authenticated;
grant execute on function public.book_online(jsonb) to service_role;

create or replace function public.booking_by_token(p_token uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.booking_summary(job_id) from public.booking_tokens where token = p_token;
$$;
revoke all on function public.booking_by_token(uuid) from public, anon, authenticated;
grant execute on function public.booking_by_token(uuid) to service_role;

create or replace function public.cancel_booking_by_token(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  job_key bigint;
begin
  select job_id into job_key from public.booking_tokens where token = p_token;
  if job_key is null then raise exception 'This booking link is not valid.'; end if;
  perform 1 from public.jobs where id = job_key for update;
  if not (public.booking_summary(job_key)->>'can_change')::boolean then
    raise exception 'This booking can no longer be changed online. Please call the workshop.';
  end if;
  update public.jobs set status = 'Cancelled' where id = job_key;
  return public.booking_summary(job_key);
end;
$$;
revoke all on function public.cancel_booking_by_token(uuid) from public, anon, authenticated;
grant execute on function public.cancel_booking_by_token(uuid) to service_role;

-- Moving a booking puts it back for confirmation unless it is one of the instant services.
create or replace function public.move_booking_by_token(p_token uuid, p_date date, p_time time)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  job_row public.jobs%rowtype;
  job_key bigint;
begin
  select job_id into job_key from public.booking_tokens where token = p_token;
  if job_key is null then raise exception 'This booking link is not valid.'; end if;
  select * into job_row from public.jobs where id = job_key for update;
  if not (public.booking_summary(job_key)->>'can_change')::boolean then
    raise exception 'This booking can no longer be changed online. Please call the workshop.';
  end if;
  if p_date is null or p_time is null or p_time <> all(public.workshop_slot_times()) then
    raise exception 'Please choose a date and time.';
  end if;
  if not public.workshop_open_on(p_date) then
    raise exception 'We are not taking online bookings on that day. Please choose another.';
  end if;
  if p_date + p_time <= (now() at time zone 'Europe/London') then
    raise exception 'That time has passed. Please choose another.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('slot:' || p_date || ' ' || p_time, 0));
  if exists (select 1 from public.jobs where id <> job_key and booking_date = p_date and booking_time = p_time
    and status <> 'Cancelled')
  then
    raise exception 'That time has just been taken. Please choose another.';
  end if;
  if exists (select 1 from public.jobs where id <> job_key and vehicle_id = job_row.vehicle_id
    and booking_date = p_date and status not in ('Completed', 'Cancelled', 'No-show'))
  then
    raise exception 'There is already a booking for this vehicle on that date. Please contact the workshop for changes.';
  end if;
  update public.jobs set booking_date = p_date, booking_time = p_time,
    status = case when lower(service_type) in ('interim service', 'full service', 'major service')
      then 'Booked' else 'Pending Confirmation' end
    where id = job_key;
  return public.booking_summary(job_key);
end;
$$;
revoke all on function public.move_booking_by_token(uuid,date,time) from public, anon, authenticated;
grant execute on function public.move_booking_by_token(uuid,date,time) to service_role;

-- For staff emails: the server checks the sender may manage bookings before calling this.
create or replace function public.booking_email_details(p_job_id bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'This booking no longer exists.';
  end if;
  return public.booking_summary(p_job_id) || jsonb_build_object('token', public.booking_token_for(p_job_id));
end;
$$;
revoke all on function public.booking_email_details(bigint) from public, anon, authenticated;
grant execute on function public.booking_email_details(bigint) to service_role;

commit;

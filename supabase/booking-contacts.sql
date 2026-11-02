-- Run after staff-access.sql. Rerun after it or setup.sql.
-- Phones match on their last 10 digits, so +44 and 07 versions of a number are the same.
-- A different phone on a car with an active booking is asked whether to change that booking.
-- Completed jobs never block new bookings, and keep a permanent copy of who and what they were.
begin;

alter table public.jobs add column if not exists contact_name text not null default '' check (length(contact_name) <= 170);
alter table public.jobs add column if not exists contact_phone text not null default '' check (length(contact_phone) <= 25);
alter table public.jobs add column if not exists replaces_job_id bigint references public.jobs(id) on delete set null;
alter table public.jobs add column if not exists completed_at timestamptz;
alter table public.jobs add column if not exists completed_record jsonb;

-- Corrections made while a job is completed refresh the copy. Job card saves leave it alone.
create or replace function public.record_job_completion()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'Completed' then
    if old.status <> 'Completed' then new.completed_at := now(); end if;
    if old.status <> 'Completed' or new.job_card = old.job_card then
      select jsonb_build_object('name', coalesce(nullif(new.contact_name, ''), trim(c.first_name || ' ' || c.last_name)),
          'phone', coalesce(nullif(new.contact_phone, ''), c.phone), 'reg_no', v.reg_no, 'make', v.make, 'model', v.model)
        into new.completed_record
        from public.vehicles v left join public.customers c on c.id = v.customer_id
        where v.id = new.vehicle_id;
    end if;
  elsif old.status = 'Completed' then
    new.completed_at := null;
    new.completed_record := null;
  end if;
  return new;
end;
$$;
drop trigger if exists jobs_record_completion on public.jobs;
create trigger jobs_record_completion before update on public.jobs
  for each row execute function public.record_job_completion();

update public.jobs j set completed_at = coalesce(j.completed_at, j.updated_at), completed_record = jsonb_build_object(
    'name', trim(c.first_name || ' ' || c.last_name), 'phone', c.phone, 'reg_no', v.reg_no, 'make', v.make, 'model', v.model)
  from public.vehicles v left join public.customers c on c.id = v.customer_id
  where v.id = j.vehicle_id and j.status = 'Completed' and j.completed_record is null;

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
    and booking_date = p_booking_date and status <> 'Completed')
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
  vehicle_key bigint;
  existing_phone text;
  active_job bigint;
  change_request boolean := coalesce((p_details->>'change_request')::boolean, false);
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
    select id into active_job from public.jobs where vehicle_id = vehicle_key and status <> 'Completed'
      order by booking_date, id limit 1;
    if active_job is not null and not owner_access then
      if not change_request then return 'Already Booked'; end if;
      status_value := 'Pending Confirmation';
    else
      active_job := null;
      if exists (select 1 from public.jobs where vehicle_id = vehicle_key
        and booking_date = date_value and status <> 'Completed')
      then
        raise exception 'There is already a request or booking for this vehicle on that date. Please contact the workshop for changes.';
      end if;
    end if;
    insert into public.jobs (vehicle_id, booking_date, booking_time, status, payment_status, amount_due, service_type,
      customer_address, customer_postcode, contact_name, contact_phone, replaces_job_id)
      values (vehicle_key, date_value, time_value, status_value, 'Unpaid', 0, service_value,
        address_value, postcode_value, name_value, phone_value, active_job);
    return status_value;
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


-- Approving a change request replaces the booking it was raised against.
create or replace function public.approve_booking(p_job_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  old_job bigint;
begin
  if not public.has_permission('bookings_manage') then
    raise exception 'You do not have permission to approve bookings.';
  end if;
  update public.jobs set status = 'Booked' where id = p_job_id and status = 'Pending Confirmation'
    returning replaces_job_id into old_job;
  if not found then raise exception 'This request has already been handled.'; end if;
  if old_job is not null then
    update public.jobs j set job_card = o.job_card, replaces_job_id = null
      from public.jobs o where j.id = p_job_id and o.id = old_job and o.status <> 'Completed';
    delete from public.jobs where id = old_job and status <> 'Completed';
  end if;
end;
$$;

commit;

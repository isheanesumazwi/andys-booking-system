-- Run after every other migration, including job-photos.sql. Rerun after any of them.
-- Replaces the single owner check with per-person permissions. Table access is withdrawn, so
-- signed-in users can only act through the checked functions below. Deploy the matching
-- frontend straight after running this.
begin;

create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 80),
  email text not null,
  role text not null check (length(trim(role)) between 1 and 40),
  permissions text[] not null default '{}' check (permissions <@ array[
    'bookings_view', 'bookings_manage', 'bookings_delete', 'job_cards', 'payments', 'checks', 'admin'
  ]::text[]),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;
revoke all on public.staff from anon, authenticated;

-- Existing owners keep full access.
insert into public.staff (user_id, full_name, email, role, permissions)
  select a.user_id, split_part(u.email, '@', 1), u.email, 'Owner',
    array['bookings_view', 'bookings_manage', 'bookings_delete', 'job_cards', 'payments', 'checks', 'admin']
  from public.app_admins a join auth.users u on u.id = a.user_id
  on conflict (user_id) do nothing;

create or replace function public.has_permission(p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff
    where user_id = auth.uid() and active and p_permission = any(permissions));
$$;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

create or replace function public.is_workshop_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and active);
$$;

revoke select, update, delete on public.jobs, public.customers, public.vehicles from authenticated;
revoke all on public.app_admins from authenticated;

create or replace function public.my_staff_profile()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('full_name', full_name, 'email', email, 'role', role, 'permissions', to_jsonb(permissions))
  from public.staff where user_id = auth.uid() and active;
$$;
revoke all on function public.my_staff_profile() from public, anon;
grant execute on function public.my_staff_profile() to authenticated;

-- Removes prices from what reaches the browser for anyone without the payments permission.
create or replace function public.list_workshop_jobs()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  view_access boolean := public.has_permission('bookings_view');
  card_access boolean := public.has_permission('job_cards');
  payment_access boolean := public.has_permission('payments');
  rows jsonb;
begin
  if not (view_access or card_access or payment_access) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(
    case when payment_access then base else
      jsonb_set(base - 'amount_due' - 'payment_status', '{job_card}', (base->'job_card') - 'parts' - 'labour')
    end order by booking_date, booking_time, id), '[]'::jsonb) into rows
  from (
    select j.booking_date, j.booking_time, j.id,
      (case when card_access or payment_access then to_jsonb(j)
        else jsonb_set(to_jsonb(j), '{job_card}', '{}'::jsonb) end)
      || jsonb_build_object('vehicle', to_jsonb(v) || jsonb_build_object('customer', to_jsonb(c))) as base
    from public.jobs j
    left join public.vehicles v on v.id = j.vehicle_id
    left join public.customers c on c.id = v.customer_id
  ) listed;
  return rows;
end;
$$;
revoke all on function public.list_workshop_jobs() from public, anon;
grant execute on function public.list_workshop_jobs() to authenticated;

create or replace function public.approve_booking(p_job_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_permission('bookings_manage') then
    raise exception 'You do not have permission to approve bookings.';
  end if;
  update public.jobs set status = 'Booked' where id = p_job_id and status = 'Pending Confirmation';
  if not found then raise exception 'This request has already been handled.'; end if;
end;
$$;
revoke all on function public.approve_booking(bigint) from public, anon;
grant execute on function public.approve_booking(bigint) to authenticated;

-- Lets mechanics move a job along without being able to edit the booking.
create or replace function public.set_job_status(p_job_id bigint, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not (public.has_permission('job_cards') or public.has_permission('bookings_manage')) then
    raise exception 'You do not have permission to change the job status.';
  end if;
  if p_status is null or p_status not in ('Booked', 'In Progress', 'Rescheduled', 'Completed') then
    raise exception 'Please choose a valid job status.';
  end if;
  update public.jobs set status = p_status where id = p_job_id and status <> 'Pending Confirmation';
  if not found then raise exception 'This job is not confirmed yet.'; end if;
end;
$$;
revoke all on function public.set_job_status(bigint,text) from public, anon;
grant execute on function public.set_job_status(bigint,text) to authenticated;

create or replace function public.delete_booking(p_job_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_permission('bookings_delete') then
    raise exception 'You do not have permission to delete bookings.';
  end if;
  delete from public.jobs where id = p_job_id;
  if not found then raise exception 'This booking no longer exists.'; end if;
end;
$$;

create or replace function public.save_job_card(p_job_id bigint, p_card jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  saved_card jsonb;
begin
  if not public.has_permission('job_cards') then
    raise exception 'You do not have permission to update job cards.';
  end if;
  if p_card is null or jsonb_typeof(p_card) <> 'object' or octet_length(p_card::text) > 200000 then
    raise exception 'The job card is invalid or too large to save.';
  end if;
  select job_card into saved_card from public.jobs where id = p_job_id for update;
  if not found then raise exception 'This booking no longer exists.'; end if;
  -- Someone who can't see prices sends none, so the saved ones must be kept.
  if not public.has_permission('payments') then
    p_card := (p_card - 'parts' - 'labour') || jsonb_build_object(
      'parts', coalesce(saved_card->'parts', '[]'::jsonb), 'labour', coalesce(saved_card->'labour', '[]'::jsonb));
  end if;
  update public.jobs set job_card = p_card where id = p_job_id;
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
    amount_due = case when payment_access then (p_details->>'amount_due')::numeric else amount_due end,
    payment_status = case when payment_access then payment_value else payment_status end
    where id = p_job_id;
end;
$$;

create or replace function public.require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_permission('admin') then
    raise exception 'You do not have permission to manage users.';
  end if;
end;
$$;
revoke all on function public.require_admin() from public, anon, authenticated;

create or replace function public.require_active_admin_remains()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.staff where active and 'admin' = any(permissions)) then
    raise exception 'The site must keep at least one active administrator.';
  end if;
end;
$$;
revoke all on function public.require_active_admin_remains() from public, anon, authenticated;

create or replace function public.list_staff()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  rows jsonb;
begin
  perform public.require_admin();
  select coalesce(jsonb_agg(to_jsonb(s) order by s.active desc, s.full_name), '[]'::jsonb) into rows from public.staff s;
  return rows;
end;
$$;
revoke all on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;

-- The account must already exist; /api/staff creates it first when given a password.
create or replace function public.add_staff_member(p_email text, p_name text, p_role text, p_permissions text[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  account auth.users%rowtype;
begin
  perform public.require_admin();
  select * into account from auth.users where lower(email) = lower(trim(p_email));
  if not found then raise exception 'No account exists for that email. Set a temporary password to create one.'; end if;
  if exists (select 1 from public.staff where user_id = account.id) then
    raise exception 'That person is already on the team.';
  end if;
  insert into public.staff (user_id, full_name, email, role, permissions)
    values (account.id, trim(p_name), account.email, trim(p_role), p_permissions);
end;
$$;
revoke all on function public.add_staff_member(text,text,text,text[]) from public, anon;
grant execute on function public.add_staff_member(text,text,text,text[]) to authenticated;

create or replace function public.update_staff_member(p_user_id uuid, p_name text, p_role text, p_permissions text[], p_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  lock table public.staff in share row exclusive mode;
  update public.staff set full_name = trim(p_name), role = trim(p_role), permissions = p_permissions, active = p_active
    where user_id = p_user_id;
  if not found then raise exception 'This person is no longer on the team.'; end if;
  perform public.require_active_admin_remains();
end;
$$;
revoke all on function public.update_staff_member(uuid,text,text,text[],boolean) from public, anon;
grant execute on function public.update_staff_member(uuid,text,text,text[],boolean) to authenticated;

-- Removes site access. The login itself remains, so re-adding the same email works.
create or replace function public.remove_staff_member(p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  lock table public.staff in share row exclusive mode;
  delete from public.staff where user_id = p_user_id;
  if not found then raise exception 'This person is no longer on the team.'; end if;
  perform public.require_active_admin_remains();
end;
$$;
revoke all on function public.remove_staff_member(uuid) from public, anon;
grant execute on function public.remove_staff_member(uuid) to authenticated;

drop policy if exists owner_read_job_photos on storage.objects;
create policy owner_read_job_photos on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and public.is_workshop_admin());
drop policy if exists owner_add_job_photos on storage.objects;
create policy owner_add_job_photos on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and public.has_permission('job_cards'));
drop policy if exists owner_remove_job_photos on storage.objects;
create policy owner_remove_job_photos on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and (public.has_permission('job_cards') or public.has_permission('bookings_delete')));

commit;

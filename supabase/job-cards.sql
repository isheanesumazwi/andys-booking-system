-- Run after setup.sql and booking-updates.sql, including on existing installations.
-- Adds the workshop job card (service checklist, inspection, parts, labour and QC) to each job.
begin;

alter table public.jobs add column if not exists job_card jsonb not null default '{}'::jsonb;
alter table public.jobs drop constraint if exists jobs_job_card_check;
alter table public.jobs add constraint jobs_job_card_check
  check (jsonb_typeof(job_card) = 'object' and octet_length(job_card::text) <= 200000);

-- The job_card column is not in the owner's column update grant, so this RPC is the only writer.
create or replace function public.save_job_card(p_job_id bigint, p_card jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_workshop_admin() then
    raise exception 'Only the workshop owner can update job cards.';
  end if;
  if p_card is null or jsonb_typeof(p_card) <> 'object' or octet_length(p_card::text) > 200000 then
    raise exception 'The job card is invalid or too large to save.';
  end if;
  update public.jobs set job_card = p_card where id = p_job_id;
  if not found then raise exception 'This booking no longer exists.'; end if;
end;
$$;
revoke all on function public.save_job_card(bigint,jsonb) from public, anon;
grant execute on function public.save_job_card(bigint,jsonb) to authenticated;

commit;

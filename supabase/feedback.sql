-- Run after owner-tools.sql. Safe to rerun.
-- Adds customer ratings and suggestions. Anyone can send one through the site's /api/feedback
-- function. Only people with the Admin centre permission can read them, and the site only shows
-- reviews that the customer agreed to share and an admin has approved.
begin;

create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 600),
  display_name text not null default '' check (char_length(display_name) <= 60),
  can_publish boolean not null default false,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Hidden')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  -- Only reviews the customer agreed to share can ever be approved.
  constraint feedback_publish_consent check (status <> 'Approved' or can_publish)
);
create index if not exists feedback_status_idx on public.feedback(status, created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- Called by the site's server after its spam checks, never from the browser.
create or replace function public.submit_feedback(p_rating integer, p_comment text, p_name text, p_publish boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  clean_comment text := btrim(coalesce(p_comment, ''));
  clean_name text := btrim(coalesce(p_name, ''));
begin
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Please choose a rating from 1 to 5 stars.';
  end if;
  if char_length(clean_comment) > 600 then
    raise exception 'Please keep your comments to 600 characters.';
  end if;
  if char_length(clean_name) > 60 then
    raise exception 'Please keep your name to 60 characters.';
  end if;
  -- A ceiling on everyone's submissions keeps a flood of spam from filling the table.
  if (select count(*) from public.feedback where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'We are receiving a lot of feedback right now. Please try again later.';
  end if;
  insert into public.feedback (rating, comment, display_name, can_publish)
  values (p_rating, clean_comment, clean_name, coalesce(p_publish, false));
end;
$$;
revoke all on function public.submit_feedback(integer, text, text, boolean) from public, anon, authenticated;
grant execute on function public.submit_feedback(integer, text, text, boolean) to service_role;

-- Public: approved reviews for the website, with the average of those shown.
create or replace function public.published_reviews()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'count', (select count(*) from public.feedback where status = 'Approved' and can_publish),
    'average', (select round(avg(rating)::numeric, 1) from public.feedback where status = 'Approved' and can_publish),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'rating', rating, 'comment', comment,
        'name', display_name, 'date', to_char(created_at at time zone 'Europe/London', 'YYYY-MM-DD')) order by created_at desc)
      from (select * from public.feedback where status = 'Approved' and can_publish order by created_at desc limit 12) latest), '[]'));
$$;
revoke all on function public.published_reviews() from public;
grant execute on function public.published_reviews() to anon, authenticated;

create or replace function public.list_feedback()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_permission('admin') then
    raise exception 'You do not have permission to see feedback.';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc)
    from (select id, rating, comment, display_name, can_publish, status, created_at, reviewed_at
          from public.feedback order by created_at desc limit 300) f), '[]');
end;
$$;
revoke all on function public.list_feedback() from public, anon;
grant execute on function public.list_feedback() to authenticated;

-- Approved shows it on the website straight away. Hidden keeps it out of sight.
create or replace function public.review_feedback(p_id bigint, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_permission('admin') then
    raise exception 'You do not have permission to review feedback.';
  end if;
  if p_status is null or p_status not in ('Pending', 'Approved', 'Hidden') then
    raise exception 'That is not a valid feedback status.';
  end if;
  if p_status = 'Approved' and not exists (select 1 from public.feedback where id = p_id and can_publish) then
    raise exception 'This person did not agree to have their feedback shown on the website.';
  end if;
  update public.feedback set status = p_status, reviewed_at = now() where id = p_id;
  if not found then raise exception 'That feedback no longer exists.'; end if;
end;
$$;
revoke all on function public.review_feedback(bigint, text) from public, anon;
grant execute on function public.review_feedback(bigint, text) to authenticated;

create or replace function public.delete_feedback(p_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_permission('admin') then
    raise exception 'You do not have permission to delete feedback.';
  end if;
  delete from public.feedback where id = p_id;
end;
$$;
revoke all on function public.delete_feedback(bigint) from public, anon;
grant execute on function public.delete_feedback(bigint) to authenticated;

commit;

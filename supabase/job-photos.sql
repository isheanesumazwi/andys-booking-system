-- Run after job-cards.sql. Private storage for before and after inspection photos.
-- Only the workshop owner can see, add or remove them.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('job-photos', 'job-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists owner_read_job_photos on storage.objects;
create policy owner_read_job_photos on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and public.is_workshop_admin());
drop policy if exists owner_add_job_photos on storage.objects;
create policy owner_add_job_photos on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and public.is_workshop_admin());
drop policy if exists owner_remove_job_photos on storage.objects;
create policy owner_remove_job_photos on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and public.is_workshop_admin());

commit;

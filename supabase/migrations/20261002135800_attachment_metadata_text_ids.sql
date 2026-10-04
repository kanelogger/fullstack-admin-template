drop function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint);

create function public.create_attachment_metadata(
  p_original_name text,
  p_storage_path text,
  p_mime_type text,
  p_file_ext text,
  p_file_size bigint,
  p_business_module text,
  p_business_record_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id bigint;
  created_attachment public.attachments;
begin
  if (select auth.uid()) is null
     or not (select app_private.is_password_authenticated()) then
    raise exception using errcode = '42501', message = 'A registered password session is required';
  end if;
  if not (select app_private.has_permission('files.attachments.upload')) then
    raise exception using errcode = '42501', message = 'Attachment upload permission is required';
  end if;

  actor_id := (select public.current_business_user_id())::bigint;
  if actor_id is null
     or nullif(trim(p_original_name), '') is null
     or length(p_original_name) > 255
     or p_original_name ~ '[[:cntrl:]]'
     or p_storage_path is null
     or p_mime_type is null
     or nullif(trim(p_mime_type), '') is null
     or length(p_mime_type) > 128
     or p_file_ext is null
     or p_file_ext !~ '^[a-z0-9]{1,32}$'
     or p_file_size is null
     or p_file_size not between 0 and 20971520
     or (p_business_module is not null and (
       nullif(trim(p_business_module), '') is null
       or length(p_business_module) > 64
     ))
     or (p_business_record_id is not null and p_business_record_id <= 0)
     or p_storage_path !~ ('^' || actor_id::text || '/[0-9a-f-]{36}\.[a-z0-9]{1,32}$') then
    raise exception using errcode = '22023', message = 'Attachment metadata is invalid';
  end if;

  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'admin-attachments'
      and object.name = p_storage_path
      and object.owner_id = (select auth.uid()::text)
  ) then
    raise exception using errcode = '23503', message = 'Uploaded storage object is missing';
  end if;

  insert into public.attachments (
    original_name,
    storage_path,
    mime_type,
    file_ext,
    file_size,
    business_module,
    business_record_id,
    reference_status,
    upload_user_id,
    created_by,
    updated_by
  ) values (
    trim(p_original_name),
    p_storage_path,
    trim(p_mime_type),
    p_file_ext,
    p_file_size,
    nullif(trim(p_business_module), ''),
    p_business_record_id,
    1,
    actor_id,
    actor_id,
    actor_id
  ) returning * into created_attachment;

  return jsonb_build_object(
    'id', created_attachment.id::text,
    'original_name', created_attachment.original_name,
    'storage_path', created_attachment.storage_path,
    'mime_type', created_attachment.mime_type,
    'file_ext', created_attachment.file_ext,
    'file_size', created_attachment.file_size,
    'business_module', created_attachment.business_module,
    'business_record_id', created_attachment.business_record_id::text,
    'reference_status', created_attachment.reference_status,
    'upload_user_id', created_attachment.upload_user_id::text,
    'uploaded_at', created_attachment.uploaded_at
  );
end;
$$;

revoke all on function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint)
  from public, anon;
grant execute on function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint)
  to authenticated;
comment on function public.create_attachment_metadata(text, text, text, text, bigint, text, bigint) is
  'Creates an attachment and returns BIGINT identifiers as decimal text.';

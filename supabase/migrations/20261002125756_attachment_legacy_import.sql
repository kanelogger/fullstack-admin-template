alter table public.attachments
  drop constraint attachments_business_reference_pair,
  drop constraint attachments_reference_status_matches_link,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

create or replace function public.create_attachment_metadata(
  p_original_name text,
  p_storage_path text,
  p_mime_type text,
  p_file_ext text,
  p_file_size bigint,
  p_business_module text,
  p_business_record_id bigint
)
returns public.attachments
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

  return created_attachment;
end;
$$;

create function public.import_legacy_attachments(p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_count integer;
  rows_to_insert integer;
  inserted_count integer := 0;
  maximum_id bigint;
  sequence_last_value bigint;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Attachment import input must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 100 then
    raise exception using errcode = '22023', message = 'Attachment import batches must contain at most 100 rows';
  end if;

  select count(*) into source_count from jsonb_array_elements(p_rows);
  if source_count = 0 then
    return jsonb_build_object(
      'sourceCount', 0,
      'alreadyPresentCount', 0,
      'rowsToInsert', 0,
      'insertedCount', 0
    );
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text,
      original_name text,
      storage_path text,
      mime_type text,
      file_ext text,
      file_size text,
      business_module text,
      business_record_id text,
      reference_status text,
      upload_user_id text,
      uploaded_at text,
      created_by text,
      created_at text,
      updated_by text,
      updated_at text,
      deleted text
    )
    where source.id !~ '^[1-9][0-9]*$'
       or case when source.id ~ '^[1-9][0-9]*$' then source.id::numeric > 9223372036854775807 else true end
       or source.original_name is null
       or length(trim(source.original_name)) not between 1 and 255
       or source.original_name ~ '[[:cntrl:]]'
       or source.storage_path is null
       or source.storage_path !~ ('^legacy/' || source.id || '/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$')
       or source.mime_type is null
       or length(trim(source.mime_type)) not between 1 and 128
       or source.file_ext is null
       or source.file_ext !~ '^[a-z0-9]{1,32}$'
       or case when source.file_size ~ '^(0|[1-9][0-9]*)$' then source.file_size::numeric > 20971520 else true end
       or source.file_size !~ '^(0|[1-9][0-9]*)$'
       or (source.business_module is not null and length(source.business_module) > 64)
       or (source.business_record_id is not null and (
         source.business_record_id !~ '^[1-9][0-9]*$'
         or case when source.business_record_id ~ '^[1-9][0-9]*$'
           then source.business_record_id::numeric > 9223372036854775807 else true end
       ))
       or source.reference_status is null
       or source.reference_status not in ('0', '1')
       or source.upload_user_id !~ '^[1-9][0-9]*$'
       or case when source.upload_user_id ~ '^[1-9][0-9]*$'
         then source.upload_user_id::numeric > 9223372036854775807 else true end
       or source.uploaded_at is null
       or source.created_at is null
       or source.updated_at is null
       or source.deleted is null
       or source.deleted not in ('true', 'false')
       or (source.created_by is not null and source.created_by !~ '^[1-9][0-9]*$')
       or (source.created_by is not null and case when source.created_by ~ '^[1-9][0-9]*$'
         then source.created_by::numeric > 9223372036854775807 else true end)
       or (source.updated_by is not null and source.updated_by !~ '^[1-9][0-9]*$')
       or (source.updated_by is not null and case when source.updated_by ~ '^[1-9][0-9]*$'
         then source.updated_by::numeric > 9223372036854775807 else true end)
  ) then
    raise exception using errcode = '22023', message = 'Legacy attachment row is invalid';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(id text)
    group by source.id
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Legacy attachment batch contains duplicate IDs';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(storage_path text)
    group by source.storage_path
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Legacy attachment batch contains duplicate storage paths';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, storage_path text, upload_user_id text, created_by text, updated_by text
    )
    left join public.profiles as uploader on uploader.id = source.upload_user_id::bigint
    left join public.profiles as creator on creator.id = source.created_by::bigint
    left join public.profiles as updater on updater.id = source.updated_by::bigint
    where uploader.id is null
       or (source.created_by is not null and creator.id is null)
       or (source.updated_by is not null and updater.id is null)
       or exists (
         select 1 from public.attachments as other
         where other.storage_path = source.storage_path
           and other.id <> source.id::bigint
       )
  ) then
    raise exception using errcode = '23503', message = 'Legacy attachment references are invalid or conflict with existing rows';
  end if;

  if p_apply and exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(storage_path text, deleted text)
    where source.deleted = 'false'
      and not exists (
        select 1 from storage.objects as object
        where object.bucket_id = 'admin-attachments'
          and object.name = source.storage_path
      )
  ) then
    raise exception using errcode = '23503', message = 'An active legacy attachment object is missing from private Storage';
  end if;

  if exists (
    with source as (
      select * from jsonb_to_recordset(p_rows) as row_data(
        id text, original_name text, storage_path text, mime_type text, file_ext text,
        file_size text, business_module text, business_record_id text, reference_status text,
        upload_user_id text, uploaded_at text, created_by text, created_at text,
        updated_by text, updated_at text, deleted text
      )
    )
    select 1
    from source
    join public.attachments as current on current.id = source.id::bigint
    where current.original_name is distinct from source.original_name
       or current.storage_path is distinct from source.storage_path
       or current.mime_type is distinct from source.mime_type
       or current.file_ext is distinct from source.file_ext
       or current.file_size is distinct from source.file_size::bigint
       or current.business_module is distinct from source.business_module
       or current.business_record_id is distinct from source.business_record_id::bigint
       or current.reference_status is distinct from source.reference_status::smallint
       or current.upload_user_id is distinct from source.upload_user_id::bigint
       or current.uploaded_at is distinct from source.uploaded_at::timestamptz
       or current.created_by is distinct from source.created_by::bigint
       or current.created_at is distinct from source.created_at::timestamptz
       or current.updated_by is distinct from source.updated_by::bigint
       or current.updated_at is distinct from source.updated_at::timestamptz
       or current.deleted_at is distinct from case when source.deleted = 'true' then source.updated_at::timestamptz else null end
  ) then
    raise exception using errcode = '23505', message = 'Legacy attachment import conflicts with existing metadata';
  end if;

  select count(*)::integer into rows_to_insert
  from jsonb_to_recordset(p_rows) as source(id text)
  where not exists (
    select 1 from public.attachments as current where current.id = source.id::bigint
  );

  if p_apply and rows_to_insert > 0 then
    insert into public.attachments (
      id, original_name, storage_path, mime_type, file_ext, file_size,
      business_module, business_record_id, reference_status, upload_user_id,
      uploaded_at, created_by, created_at, updated_by, updated_at, deleted_at
    )
    select
      source.id::bigint,
      source.original_name,
      source.storage_path,
      source.mime_type,
      source.file_ext,
      source.file_size::bigint,
      source.business_module,
      source.business_record_id::bigint,
      source.reference_status::smallint,
      source.upload_user_id::bigint,
      source.uploaded_at::timestamptz,
      source.created_by::bigint,
      source.created_at::timestamptz,
      source.updated_by::bigint,
      source.updated_at::timestamptz,
      case when source.deleted = 'true' then source.updated_at::timestamptz else null end
    from jsonb_to_recordset(p_rows) as source(
      id text, original_name text, storage_path text, mime_type text, file_ext text,
      file_size text, business_module text, business_record_id text, reference_status text,
      upload_user_id text, uploaded_at text, created_by text, created_at text,
      updated_by text, updated_at text, deleted text
    )
    where not exists (
      select 1 from public.attachments as current where current.id = source.id::bigint
    );
    get diagnostics inserted_count = row_count;

    select coalesce(max(id), 1) into maximum_id from public.attachments;
    select last_value into sequence_last_value from public.attachments_id_seq;
    perform setval(
      'public.attachments_id_seq'::regclass,
      greatest(maximum_id, sequence_last_value),
      true
    );
  end if;

  return jsonb_build_object(
    'sourceCount', source_count,
    'alreadyPresentCount', source_count - rows_to_insert,
    'rowsToInsert', rows_to_insert,
    'insertedCount', inserted_count
  );
end;
$$;

revoke all on function public.import_legacy_attachments(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_legacy_attachments(jsonb, boolean) to service_role;
comment on function public.import_legacy_attachments(jsonb, boolean) is
  'Idempotently imports attachment metadata only after local Storage objects and business-user mappings are present.';

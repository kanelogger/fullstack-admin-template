-- A fresh template provisions application identities through Supabase Auth.
-- Historical MySQL imports are no longer part of the supported runtime.
alter table public.profiles
  alter column auth_user_id set not null;

comment on column public.profiles.auth_user_id is
  'Required mapping from the business profile to its Supabase Auth identity.';

comment on column public.profiles.user_code is
  'Optional business user code; new template administrators use their login name.';

create or replace function app_private.has_permission(p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app_private.is_password_authenticated())
    and exists (
      select 1
      from public.profiles as profile
      join public.user_roles as user_role on user_role.user_id = profile.id
      join public.roles as role on role.id = user_role.role_id
      where profile.auth_user_id = (select auth.uid())
        and profile.is_active
        and profile.deleted_at is null
        and role.is_active
        and (
          role.code = 'SUPER_ADMIN'
          or exists (
            select 1
            from public.role_permissions as role_permission
            where role_permission.role_id = role.id
              and role_permission.permission_key = p_permission_key
          )
        )
    );
$$;

revoke all on function app_private.has_permission(text) from public, anon;
grant execute on function app_private.has_permission(text) to authenticated;

create or replace function app_private.is_current_profile(p_profile_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app_private.is_password_authenticated())
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = p_profile_id
        and profile.auth_user_id = (select auth.uid())
        and profile.is_active
        and profile.deleted_at is null
    );
$$;

create or replace function app_private.can_read_role(p_role_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app_private.is_password_authenticated())
    and exists (
      select 1
      from public.user_roles as user_role
      join public.profiles as profile on profile.id = user_role.user_id
      join public.roles as role on role.id = user_role.role_id
      where user_role.role_id = p_role_id
        and profile.auth_user_id = (select auth.uid())
        and profile.is_active
        and profile.deleted_at is null
        and role.is_active
    );
$$;

create function public.bootstrap_first_admin_profile(
  p_auth_user_id uuid,
  p_login_name text,
  p_display_name text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_profile public.profiles;
  new_profile_id bigint;
  super_admin_role_id bigint;
begin
  if p_auth_user_id is null
    or nullif(trim(p_login_name), '') is null
    or length(trim(p_login_name)) > 64
    or nullif(trim(p_display_name), '') is null
    or length(trim(p_display_name)) > 128
    or nullif(trim(p_email), '') is null
    or length(trim(p_email)) > 320 then
    raise exception using errcode = '22023', message = 'Initial administrator fields are invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('fullstack-admin-template:first-super-admin', 0)
  );

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_auth_user_id
      and auth_user.email_confirmed_at is not null
      and lower(auth_user.email) = lower(trim(p_email))
  ) then
    raise exception using errcode = '23514', message = 'Confirmed Auth identity is required';
  end if;

  select profile.*
  into existing_profile
  from public.profiles as profile
  where profile.auth_user_id = p_auth_user_id
  for update;

  if found then
    if existing_profile.is_active
      and existing_profile.deleted_at is null
      and lower(existing_profile.login_name) = lower(trim(p_login_name))
      and existing_profile.display_name = trim(p_display_name)
      and lower(existing_profile.email) = lower(trim(p_email))
      and exists (
        select 1
        from public.user_roles as user_role
        join public.roles as role on role.id = user_role.role_id
        where user_role.user_id = existing_profile.id
          and role.code = 'SUPER_ADMIN'
      ) then
      return jsonb_build_object(
        'id', existing_profile.id::text,
        'mustResetPassword', existing_profile.must_reset_password,
        'initialized', true
      );
    end if;
    raise exception using errcode = '23505', message = 'Auth identity already has a different profile';
  end if;

  if exists (
    select 1
    from public.user_roles as user_role
    join public.roles as role on role.id = user_role.role_id
    where role.code = 'SUPER_ADMIN'
  ) then
    raise exception using errcode = '23505', message = 'An initial administrator already exists';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where lower(profile.login_name) = lower(trim(p_login_name))
       or lower(profile.email) = lower(trim(p_email))
       or lower(profile.user_code) = lower(trim(p_login_name))
  ) then
    raise exception using errcode = '23505', message = 'Administrator login or email is already in use';
  end if;

  select role.id
  into super_admin_role_id
  from public.roles as role
  where role.code = 'SUPER_ADMIN'
    and role.is_active;
  if super_admin_role_id is null then
    raise exception using errcode = '23514', message = 'SUPER_ADMIN role is missing or inactive';
  end if;

  insert into public.profiles (
    auth_user_id,
    user_code,
    login_name,
    display_name,
    email,
    is_active,
    must_reset_password
  ) values (
    p_auth_user_id,
    trim(p_login_name),
    trim(p_login_name),
    trim(p_display_name),
    lower(trim(p_email)),
    true,
    true
  )
  returning id into new_profile_id;

  insert into public.user_roles (user_id, role_id)
  values (new_profile_id, super_admin_role_id);

  return jsonb_build_object(
    'id', new_profile_id::text,
    'mustResetPassword', true,
    'initialized', true
  );
end;
$$;

revoke all on function public.bootstrap_first_admin_profile(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin_profile(uuid, text, text, text)
  to service_role;
comment on function public.bootstrap_first_admin_profile(uuid, text, text, text) is
  'One-time transactional first-administrator bootstrap; callable only with the service role.';

-- Keep old migrations as history while removing their import-only RPCs.
drop function public.import_legacy_user_profiles(jsonb, boolean);
drop function public.import_legacy_menus(jsonb, boolean);
drop function public.import_legacy_messages(jsonb, boolean);
drop function public.import_legacy_departments(jsonb, boolean);
drop function public.import_legacy_posts(jsonb, boolean);
drop function public.assert_legacy_organization_references(text[], text[]);
drop function public.import_legacy_dict_types(jsonb, boolean);
drop function public.import_legacy_dict_items(jsonb, text[], boolean);
drop function public.import_legacy_system_configs(jsonb, boolean);
drop function public.import_legacy_attachments(jsonb, boolean);
drop function public.import_legacy_login_logs(jsonb, boolean);
drop function public.import_legacy_operation_logs(jsonb, boolean);
drop function public.import_legacy_exception_logs(jsonb, boolean);
drop function app_private.assert_legacy_import_batch(jsonb);
drop function app_private.parse_legacy_import_timestamp(text, text);
drop function app_private.resolve_legacy_actor_id(text);

-- Fail with an actionable error instead of silently discarding partial legacy
-- attachment references; existing rows retain their original file metadata.
do $$
begin
  if exists (
    select 1
    from public.attachments
    where (business_module is null) <> (business_record_id is null)
  ) then
    raise exception 'Attachment reference metadata is incomplete; repair rows before applying this migration';
  end if;
end;
$$;

update public.attachments
set reference_status = case when business_module is null then 0 else 1 end
where reference_status is distinct from case when business_module is null then 0 else 1 end;

alter table public.attachments
  add constraint attachments_business_reference_pair check (
    (business_module is null and business_record_id is null)
    or (nullif(trim(business_module), '') is not null and business_record_id > 0)
  ),
  add constraint attachments_reference_status_matches_link check (
    reference_status = case when business_module is null then 0 else 1 end
  );

update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip'
    ]
where id = 'admin-attachments';

create or replace function public.create_attachment_metadata(
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
  normalized_module text := nullif(trim(p_business_module), '');
  normalized_mime text := lower(trim(coalesce(p_mime_type, '')));
  normalized_ext text := lower(trim(coalesce(p_file_ext, '')));
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
     or length(normalized_mime) = 0
     or length(normalized_mime) > 128
     or normalized_ext !~ '^[a-z0-9]{1,32}$'
     or p_file_size is null
     or p_file_size not between 0 and 20971520
     or (p_business_module is not null and normalized_module is null)
     or ((normalized_module is null) <> (p_business_record_id is null))
     or (p_business_record_id is not null and p_business_record_id <= 0)
     or p_storage_path !~ ('^' || actor_id::text || '/[0-9a-f-]{36}\.[a-z0-9]{1,32}$')
     or not (
       (normalized_ext in ('jpg', 'jpeg') and normalized_mime = 'image/jpeg')
       or (normalized_ext = 'png' and normalized_mime = 'image/png')
       or (normalized_ext = 'gif' and normalized_mime = 'image/gif')
       or (normalized_ext = 'webp' and normalized_mime = 'image/webp')
       or (normalized_ext = 'pdf' and normalized_mime = 'application/pdf')
       or (normalized_ext = 'txt' and normalized_mime = 'text/plain')
       or (normalized_ext = 'csv' and normalized_mime = 'text/csv')
       or (normalized_ext = 'docx' and normalized_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
       or (normalized_ext = 'xlsx' and normalized_mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
       or (normalized_ext = 'zip' and normalized_mime = 'application/zip')
     ) then
    raise exception using errcode = '22023', message = 'Attachment metadata or format is invalid';
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
    normalized_mime,
    normalized_ext,
    p_file_size,
    normalized_module,
    p_business_record_id,
    case when normalized_module is null then 0 else 1 end,
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

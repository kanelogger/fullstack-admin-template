-- Server-only, idempotent import of legacy business identities. The source
-- password_hash is deliberately absent; every imported user must reset it.
create or replace function public.import_legacy_user_profiles(p_rows jsonb, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_count integer;
  distinct_id_count integer;
  already_present_count integer;
  inserted_count integer := 0;
  maximum_profile_id bigint;
  imported_user record;
  existing_profile public.profiles%rowtype;
  existing_role_count integer;
  expected_role_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Legacy user import input must be a JSON array';
  end if;

  source_count := jsonb_array_length(p_rows);
  if source_count > 100 then
    raise exception 'Legacy user import batches cannot exceed 100 rows';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text,
      auth_user_id text,
      user_code text,
      login_name text,
      display_name text,
      email text,
      is_active boolean,
      role_ids jsonb,
      created_at timestamptz,
      updated_at timestamptz
    )
    where coalesce(source.id, '') !~ '^[1-9][0-9]*$'
       or coalesce(source.auth_user_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or nullif(trim(source.user_code), '') is null
       or nullif(trim(source.login_name), '') is null
       or nullif(trim(source.display_name), '') is null
       or nullif(trim(source.email), '') is null
       or source.role_ids is null
       or jsonb_typeof(source.role_ids) is distinct from 'array'
       or source.created_at is null
       or source.updated_at is null
  ) then
    raise exception 'Legacy user import contains invalid required fields';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) as source(row)
    where (source.row->>'id')::numeric > 9223372036854775807
       or (source.row->>'id')::numeric > 9007199254740991
       or length(trim(source.row->>'user_code')) > 64
       or length(trim(source.row->>'login_name')) > 64
       or length(trim(source.row->>'display_name')) > 128
       or length(trim(source.row->>'email')) > 320
       or (source.row->>'phone') is not null and length(source.row->>'phone') > 32
  ) then
    raise exception 'Legacy user import contains a value outside the supported range';
  end if;

  select count(distinct source.row->>'id')::integer
  into distinct_id_count
  from jsonb_array_elements(p_rows) as source(row);
  if distinct_id_count <> source_count then
    raise exception 'Legacy user import contains duplicate business IDs';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(user_code text, login_name text, email text)
    group by lower(trim(source.user_code))
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(user_code text, login_name text, email text)
    group by lower(trim(source.login_name))
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(user_code text, login_name text, email text)
    group by lower(trim(source.email))
    having count(*) > 1
  ) then
    raise exception 'Legacy user import contains duplicate account identifiers';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as source(row)
    cross join lateral jsonb_array_elements_text(source.row->'role_ids') as requested(role_id)
    left join public.roles as role on role.id = requested.role_id::bigint
    where role.id is null
  ) then
    raise exception 'Legacy user import references a role that is not mapped in Supabase';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text,
      user_code text,
      login_name text,
      email text
    )
    where exists (
      select 1 from public.profiles as profile
      where lower(profile.login_name) = lower(trim(source.login_name))
        and profile.id <> source.id::bigint
    ) or exists (
      select 1 from public.profiles as profile
      where lower(profile.email) = lower(trim(source.email))
        and profile.id <> source.id::bigint
    ) or exists (
      select 1 from public.profiles as profile
      where profile.user_code is not null
        and lower(profile.user_code) = lower(trim(source.user_code))
        and profile.id <> source.id::bigint
    )
  ) then
    raise exception 'Legacy user import conflicts with a profile identity';
  end if;

  for imported_user in
    select *
    from jsonb_to_recordset(p_rows) as row_data(
      id text,
      auth_user_id uuid,
      user_code text,
      login_name text,
      display_name text,
      email text,
      phone text,
      department_id text,
      post_id text,
      is_active boolean,
      role_ids jsonb,
      created_at timestamptz,
      updated_at timestamptz
    )
  loop
    if not exists (
      select 1 from auth.users as auth_user
      where auth_user.id = imported_user.auth_user_id
        and auth_user.email_confirmed_at is not null
        and lower(auth_user.email) = lower(trim(imported_user.email))
    ) then
      raise exception 'Legacy user import Auth identity is not confirmed or does not match';
    end if;

    select * into existing_profile
    from public.profiles as profile
    where profile.id = imported_user.id::bigint;

    if found then
      if existing_profile.auth_user_id is not null
        and existing_profile.auth_user_id <> imported_user.auth_user_id then
        raise exception 'Legacy user business ID is already mapped to another Auth identity';
      end if;
      if existing_profile.user_code is distinct from trim(imported_user.user_code)
        or existing_profile.login_name is distinct from trim(imported_user.login_name)
        or existing_profile.display_name is distinct from trim(imported_user.display_name)
        or lower(existing_profile.email) is distinct from lower(trim(imported_user.email))
        or existing_profile.phone is distinct from nullif(trim(coalesce(imported_user.phone, '')), '')
        or existing_profile.department_id is distinct from nullif(imported_user.department_id, '')::bigint
        or existing_profile.post_id is distinct from nullif(imported_user.post_id, '')::bigint
        or existing_profile.is_active is distinct from imported_user.is_active then
        raise exception 'Legacy user import conflicts with existing business profile data';
      end if;

      select count(*)::integer into existing_role_count
      from public.user_roles as user_role
      where user_role.user_id = imported_user.id::bigint;
      select count(distinct requested.role_id)::integer into expected_role_count
      from jsonb_array_elements_text(imported_user.role_ids) as requested(role_id);
      if existing_role_count <> expected_role_count or exists (
        select 1
        from jsonb_array_elements_text(imported_user.role_ids) as requested(role_id)
        where not exists (
          select 1 from public.user_roles as user_role
          where user_role.user_id = imported_user.id::bigint
            and user_role.role_id = requested.role_id::bigint
        )
      ) then
        raise exception 'Legacy user import role assignments conflict with existing data';
      end if;
    end if;
  end loop;

  select count(*)::integer into already_present_count
  from jsonb_to_recordset(p_rows) as source(id text, auth_user_id uuid)
  join public.profiles as profile on profile.id = source.id::bigint
  where profile.auth_user_id = source.auth_user_id;

  if p_apply then
    for imported_user in
      select *
      from jsonb_to_recordset(p_rows) as row_data(
        id text,
        auth_user_id uuid,
        user_code text,
        login_name text,
        display_name text,
        email text,
        phone text,
        department_id text,
        post_id text,
        is_active boolean,
        role_ids jsonb,
        created_at timestamptz,
        updated_at timestamptz
      )
    loop
      insert into public.profiles (
        id, auth_user_id, user_code, login_name, display_name, email, phone,
        department_id, post_id, is_active, must_reset_password, created_at, updated_at
      ) values (
        imported_user.id::bigint,
        imported_user.auth_user_id,
        trim(imported_user.user_code),
        trim(imported_user.login_name),
        trim(imported_user.display_name),
        lower(trim(imported_user.email)),
        nullif(trim(coalesce(imported_user.phone, '')), ''),
        nullif(imported_user.department_id, '')::bigint,
        nullif(imported_user.post_id, '')::bigint,
        imported_user.is_active,
        true,
        imported_user.created_at,
        imported_user.updated_at
      )
      on conflict (id) do update
      set auth_user_id = coalesce(public.profiles.auth_user_id, excluded.auth_user_id),
          must_reset_password = true
      where public.profiles.auth_user_id is null;

      insert into public.user_roles (user_id, role_id)
      select imported_user.id::bigint, requested.role_id::bigint
      from jsonb_array_elements_text(imported_user.role_ids) as requested(role_id)
      on conflict (user_id, role_id) do nothing;
    end loop;

    select max(id) into maximum_profile_id from public.profiles;
    if maximum_profile_id is not null then
      perform setval(
        pg_get_serial_sequence('public.profiles', 'id'),
        maximum_profile_id,
        true
      );
    end if;
    inserted_count := source_count - already_present_count;
  end if;

  return jsonb_build_object(
    'sourceCount', source_count,
    'alreadyPresentCount', already_present_count,
    'rowsToInsert', source_count - already_present_count,
    'insertedCount', inserted_count
  );
end;
$$;

revoke all on function public.import_legacy_user_profiles(jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.import_legacy_user_profiles(jsonb, boolean)
  to service_role;

comment on function public.import_legacy_user_profiles(jsonb, boolean) is
  'Server-only idempotent profile and role import; legacy password hashes are never imported.';

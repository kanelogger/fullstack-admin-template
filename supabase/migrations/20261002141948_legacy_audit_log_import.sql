create function public.import_legacy_login_logs(p_rows jsonb, p_apply boolean)
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
    raise exception using errcode = '22023', message = 'Login log import input must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 100 then
    raise exception using errcode = '22023', message = 'Login log import batches must contain at most 100 rows';
  end if;
  select count(*) into source_count from jsonb_array_elements(p_rows);
  if source_count = 0 then
    return jsonb_build_object('sourceCount', 0, 'alreadyPresentCount', 0, 'rowsToInsert', 0, 'insertedCount', 0);
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, user_id text, login_name text, login_ip text, user_agent text,
      login_result text, failure_reason text, logged_at text
    )
    where source.id !~ '^[1-9][0-9]*$'
       or case when source.id ~ '^[1-9][0-9]*$' then source.id::numeric > 9223372036854775807 else true end
       or source.login_name is null
       or length(trim(source.login_name)) not between 1 and 64
       or (source.login_ip is not null and length(source.login_ip) > 64)
       or (source.user_agent is not null and length(source.user_agent) > 512)
       or source.login_result is null
       or source.login_result not in ('0', '1')
       or (source.failure_reason is not null and length(source.failure_reason) > 255)
       or source.logged_at is null
       or (source.user_id is not null and source.user_id !~ '^[1-9][0-9]*$')
       or (source.user_id is not null and case when source.user_id ~ '^[1-9][0-9]*$'
         then source.user_id::numeric > 9223372036854775807 else true end)
  ) then
    raise exception using errcode = '22023', message = 'Legacy login log row is invalid';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as source(id text)
    group by source.id having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Login log batch contains duplicate IDs';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as source(id text, user_id text)
    left join public.profiles as profile on profile.id = source.user_id::bigint
    where source.user_id is not null and profile.id is null
  ) then
    raise exception using errcode = '23503', message = 'Login log user references are not mapped';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, user_id text, login_name text, login_ip text, user_agent text,
      login_result text, failure_reason text, logged_at text
    )
    join public.login_logs as current on current.id = source.id::bigint
    where current.user_id is distinct from source.user_id::bigint
       or current.login_name is distinct from source.login_name
       or current.login_ip is distinct from source.login_ip
       or current.user_agent is distinct from source.user_agent
       or current.login_result is distinct from source.login_result::smallint
       or current.failure_reason is distinct from source.failure_reason
       or current.logged_at is distinct from source.logged_at::timestamptz
  ) then
    raise exception using errcode = '23505', message = 'Login log import conflicts with existing data';
  end if;

  select count(*)::integer into rows_to_insert
  from jsonb_to_recordset(p_rows) as source(id text)
  where not exists (select 1 from public.login_logs as current where current.id = source.id::bigint);

  if p_apply and rows_to_insert > 0 then
    insert into public.login_logs (
      id, user_id, login_name, login_ip, user_agent, login_result, failure_reason, logged_at
    )
    select source.id::bigint, source.user_id::bigint, source.login_name, source.login_ip,
           source.user_agent, source.login_result::smallint, source.failure_reason,
           source.logged_at::timestamptz
    from jsonb_to_recordset(p_rows) as source(
      id text, user_id text, login_name text, login_ip text, user_agent text,
      login_result text, failure_reason text, logged_at text
    )
    where not exists (select 1 from public.login_logs as current where current.id = source.id::bigint);
    get diagnostics inserted_count = row_count;
    select coalesce(max(id), 1) into maximum_id from public.login_logs;
    select last_value into sequence_last_value from public.login_logs_id_seq;
    perform setval('public.login_logs_id_seq'::regclass, greatest(maximum_id, sequence_last_value), true);
  end if;
  return jsonb_build_object(
    'sourceCount', source_count,
    'alreadyPresentCount', source_count - rows_to_insert,
    'rowsToInsert', rows_to_insert,
    'insertedCount', inserted_count
  );
end;
$$;

create function public.import_legacy_operation_logs(p_rows jsonb, p_apply boolean)
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
    raise exception using errcode = '22023', message = 'Operation log import input must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 100 then
    raise exception using errcode = '22023', message = 'Operation log import batches must contain at most 100 rows';
  end if;
  select count(*) into source_count from jsonb_array_elements(p_rows);
  if source_count = 0 then
    return jsonb_build_object('sourceCount', 0, 'alreadyPresentCount', 0, 'rowsToInsert', 0, 'insertedCount', 0);
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, operator_id text, operator_name text, module_code text, operation_type text,
      request_method text, request_path text, request_params jsonb,
      operation_result text, error_message text, operated_at text
    )
    where source.id !~ '^[1-9][0-9]*$'
       or case when source.id ~ '^[1-9][0-9]*$' then source.id::numeric > 9223372036854775807 else true end
       or (source.operator_id is not null and source.operator_id !~ '^[1-9][0-9]*$')
       or (source.operator_id is not null and case when source.operator_id ~ '^[1-9][0-9]*$'
         then source.operator_id::numeric > 9223372036854775807 else true end)
       or (source.operator_name is not null and length(source.operator_name) > 128)
       or source.module_code is null or length(trim(source.module_code)) not between 1 and 64
       or source.operation_type is null or length(trim(source.operation_type)) not between 1 and 32
       or source.request_method is null or length(trim(source.request_method)) not between 1 and 16
       or source.request_path is null or length(trim(source.request_path)) not between 1 and 255
       or (source.request_params is not null and (
         jsonb_typeof(source.request_params) <> 'object'
         or pg_column_size(source.request_params) > 3000
       ))
       or source.operation_result is null or source.operation_result not in ('0', '1')
       or source.operated_at is null
  ) then
    raise exception using errcode = '22023', message = 'Legacy operation log row is invalid';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as source(id text)
    group by source.id having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Operation log batch contains duplicate IDs';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as source(id text, operator_id text)
    left join public.profiles as profile on profile.id = source.operator_id::bigint
    where source.operator_id is not null and profile.id is null
  ) then
    raise exception using errcode = '23503', message = 'Operation log actor references are not mapped';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, operator_id text, operator_name text, module_code text, operation_type text,
      request_method text, request_path text, request_params jsonb,
      operation_result text, error_message text, operated_at text
    )
    join public.operation_logs as current on current.id = source.id::bigint
    where current.operator_id is distinct from source.operator_id::bigint
       or current.operator_name is distinct from source.operator_name
       or current.module_code is distinct from source.module_code
       or current.operation_type is distinct from source.operation_type
       or current.request_method is distinct from source.request_method
       or current.request_path is distinct from source.request_path
       or current.request_params is distinct from source.request_params
       or current.operation_result is distinct from source.operation_result::smallint
       or current.error_message is distinct from source.error_message
       or current.operated_at is distinct from source.operated_at::timestamptz
  ) then
    raise exception using errcode = '23505', message = 'Operation log import conflicts with existing data';
  end if;

  select count(*)::integer into rows_to_insert
  from jsonb_to_recordset(p_rows) as source(id text)
  where not exists (select 1 from public.operation_logs as current where current.id = source.id::bigint);

  if p_apply and rows_to_insert > 0 then
    insert into public.operation_logs (
      id, operator_id, operator_name, module_code, operation_type,
      request_method, request_path, request_params, operation_result, error_message, operated_at
    )
    select source.id::bigint, source.operator_id::bigint, source.operator_name,
           source.module_code, source.operation_type, source.request_method, source.request_path,
           source.request_params, source.operation_result::smallint, source.error_message,
           source.operated_at::timestamptz
    from jsonb_to_recordset(p_rows) as source(
      id text, operator_id text, operator_name text, module_code text, operation_type text,
      request_method text, request_path text, request_params jsonb,
      operation_result text, error_message text, operated_at text
    )
    where not exists (select 1 from public.operation_logs as current where current.id = source.id::bigint);
    get diagnostics inserted_count = row_count;
    select coalesce(max(id), 1) into maximum_id from public.operation_logs;
    select last_value into sequence_last_value from public.operation_logs_id_seq;
    perform setval('public.operation_logs_id_seq'::regclass, greatest(maximum_id, sequence_last_value), true);
  end if;
  return jsonb_build_object(
    'sourceCount', source_count,
    'alreadyPresentCount', source_count - rows_to_insert,
    'rowsToInsert', rows_to_insert,
    'insertedCount', inserted_count
  );
end;
$$;

create function public.import_legacy_exception_logs(p_rows jsonb, p_apply boolean)
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
    raise exception using errcode = '22023', message = 'Exception log import input must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 100 then
    raise exception using errcode = '22023', message = 'Exception log import batches must contain at most 100 rows';
  end if;
  select count(*) into source_count from jsonb_array_elements(p_rows);
  if source_count = 0 then
    return jsonb_build_object('sourceCount', 0, 'alreadyPresentCount', 0, 'rowsToInsert', 0, 'insertedCount', 0);
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, request_path text, request_method text, error_type text,
      error_message text, stack_summary text, handled_status text, occurred_at text
    )
    where source.id !~ '^[1-9][0-9]*$'
       or case when source.id ~ '^[1-9][0-9]*$' then source.id::numeric > 9223372036854775807 else true end
       or source.request_path is null or length(trim(source.request_path)) not between 1 and 255
       or source.request_method is null or length(trim(source.request_method)) not between 1 and 16
       or source.error_type is null or length(trim(source.error_type)) not between 1 and 128
       or source.error_message is null
       or source.handled_status is null or source.handled_status not in ('0', '1')
       or source.occurred_at is null
  ) then
    raise exception using errcode = '22023', message = 'Legacy exception log row is invalid';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as source(id text)
    group by source.id having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'Exception log batch contains duplicate IDs';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as source(
      id text, request_path text, request_method text, error_type text,
      error_message text, stack_summary text, handled_status text, occurred_at text
    )
    join public.exception_logs as current on current.id = source.id::bigint
    where current.request_path is distinct from source.request_path
       or current.request_method is distinct from source.request_method
       or current.error_type is distinct from source.error_type
       or current.error_message is distinct from source.error_message
       or current.stack_summary is distinct from source.stack_summary
       or current.handled_status is distinct from source.handled_status::smallint
       or current.occurred_at is distinct from source.occurred_at::timestamptz
  ) then
    raise exception using errcode = '23505', message = 'Exception log import conflicts with existing data';
  end if;

  select count(*)::integer into rows_to_insert
  from jsonb_to_recordset(p_rows) as source(id text)
  where not exists (select 1 from public.exception_logs as current where current.id = source.id::bigint);

  if p_apply and rows_to_insert > 0 then
    insert into public.exception_logs (
      id, request_path, request_method, error_type, error_message,
      stack_summary, handled_status, occurred_at
    )
    select source.id::bigint, source.request_path, source.request_method, source.error_type,
           source.error_message, source.stack_summary, source.handled_status::smallint,
           source.occurred_at::timestamptz
    from jsonb_to_recordset(p_rows) as source(
      id text, request_path text, request_method text, error_type text,
      error_message text, stack_summary text, handled_status text, occurred_at text
    )
    where not exists (select 1 from public.exception_logs as current where current.id = source.id::bigint);
    get diagnostics inserted_count = row_count;
    select coalesce(max(id), 1) into maximum_id from public.exception_logs;
    select last_value into sequence_last_value from public.exception_logs_id_seq;
    perform setval('public.exception_logs_id_seq'::regclass, greatest(maximum_id, sequence_last_value), true);
  end if;
  return jsonb_build_object(
    'sourceCount', source_count,
    'alreadyPresentCount', source_count - rows_to_insert,
    'rowsToInsert', rows_to_insert,
    'insertedCount', inserted_count
  );
end;
$$;

revoke all on function public.import_legacy_login_logs(jsonb, boolean),
  public.import_legacy_operation_logs(jsonb, boolean),
  public.import_legacy_exception_logs(jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.import_legacy_login_logs(jsonb, boolean),
  public.import_legacy_operation_logs(jsonb, boolean),
  public.import_legacy_exception_logs(jsonb, boolean)
  to service_role;

select jsonb_build_object(
  'probe', (
    select jsonb_build_object(
      'config_code', config_code,
      'config_name', config_name,
      'config_value', config_value,
      'value_type', value_type,
      'status', status,
      'description', description
    )
    from public.system_configs
    where config_code = '__UPGRADE_PROBE_CODE__'
  ),
  'common_user_message_read', exists (
    select 1
    from public.role_permissions permission
    join public.roles role on role.id = permission.role_id
    where role.code = 'COMMON_USER'
      and permission.permission_key = 'communication.messages.read'
  )
)::text;

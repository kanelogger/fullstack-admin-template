create or replace function public.dashboard_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id bigint;
  can_read_users boolean;
  can_read_roles boolean;
  can_read_menus boolean;
  can_read_audit boolean;
  can_read_messages boolean;
  unread_count integer := 0;
  stats jsonb;
begin
  if (select auth.uid()) is null
     or not (select app_private.is_password_authenticated()) then
    raise exception using errcode = '42501', message = 'A registered password session is required';
  end if;
  if not (select app_private.has_permission('dashboard.overview.read')) then
    raise exception using errcode = '42501', message = 'Dashboard read permission is required';
  end if;

  actor_id := (select public.current_business_user_id())::bigint;
  if actor_id is null then
    raise exception using errcode = '42501', message = 'A business profile is required';
  end if;

  can_read_users := (select app_private.has_permission('administration.users.read'));
  can_read_roles := (select app_private.has_permission('administration.roles.read'));
  can_read_menus := (select app_private.has_permission('administration.menus.read'));
  can_read_audit := (select app_private.has_permission('audit.logs.read'));
  can_read_messages := (select app_private.has_permission('communication.messages.read'));

  if can_read_messages then
    select count(*)::integer
    into unread_count
    from public.messages as message
    where message.receiver_id = actor_id
      and not message.read_status
      and not message.deleted;
  end if;

  if can_read_users or can_read_roles or can_read_menus or can_read_audit then
    stats := jsonb_build_object(
      'userCount', case when can_read_users then (
        select count(*)::integer from public.profiles as profile
        where profile.is_active and profile.deleted_at is null
      ) else null end,
      'roleCount', case when can_read_roles then (
        select count(*)::integer from public.roles as role where role.is_active
      ) else null end,
      'menuCount', case when can_read_menus then (
        select count(*)::integer from public.menus as menu where menu.is_active
      ) else null end,
      'todayLoginCount', case when can_read_audit then (
        select count(*)::integer from public.login_logs as log
        where log.logged_at >= date_trunc('day', now()) and log.login_result = 1
      ) else null end,
      'apiErrorCount', case when can_read_audit then (
        select count(*)::integer from public.exception_logs as log
        where log.occurred_at >= date_trunc('day', now())
      ) else null end
    );
  end if;

  return jsonb_build_object(
    'todoCount', unread_count,
    'unreadMessageCount', unread_count,
    'todoMessages', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', todo.id::text,
            'title', todo.title,
            'summary', todo.summary,
            'messageType', todo.message_type,
            'readStatus', todo.read_status,
            'sentAt', todo.sent_at
          ) order by todo.sent_at desc, todo.id desc
        )
        from (
          select message.id, message.title, message.summary, message.message_type,
                 message.read_status, message.sent_at
          from public.messages as message
          where can_read_messages
            and message.receiver_id = actor_id
            and not message.read_status
            and not message.deleted
          order by message.sent_at desc, message.id desc
          limit 5
        ) as todo
      ),
      '[]'::jsonb
    ),
    'recentOperations', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', recent.id::text,
            'operatorName', recent.operator_name,
            'moduleCode', recent.module_code,
            'operationType', recent.operation_type,
            'requestParams', recent.request_params,
            'operationResult', recent.operation_result,
            'operatedAt', recent.operated_at
          ) order by recent.operated_at desc, recent.id desc
        )
        from (
          select log.id, log.operator_name, log.module_code, log.operation_type,
                 log.request_params, log.operation_result, log.operated_at
          from public.operation_logs as log
          where can_read_audit or log.operator_id = actor_id
          order by log.operated_at desc, log.id desc
          limit 5
        ) as recent
      ),
      '[]'::jsonb
    ),
    'recentMessages', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', recent.id::text,
            'title', recent.title,
            'summary', recent.summary,
            'messageType', recent.message_type,
            'readStatus', recent.read_status,
            'sentAt', recent.sent_at
          ) order by recent.sent_at desc, recent.id desc
        )
        from (
          select message.id, message.title, message.summary, message.message_type,
                 message.read_status, message.sent_at
          from public.messages as message
          where can_read_messages
            and message.receiver_id = actor_id
            and not message.deleted
          order by message.sent_at desc, message.id desc
          limit 5
        ) as recent
      ),
      '[]'::jsonb
    ),
    'adminStats', stats
  );
end;
$$;

revoke all on function public.dashboard_overview() from public, anon, service_role;
grant execute on function public.dashboard_overview() to authenticated;
comment on function public.dashboard_overview() is
  'Returns caller-scoped unread-message tasks and activity; every aggregate requires its module permission.';

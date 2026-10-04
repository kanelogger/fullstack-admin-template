begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(has_function_privilege('service_role', 'public.import_legacy_login_logs(jsonb,boolean)', 'execute'), 'service role can import login history');
select ok(not has_function_privilege('authenticated', 'public.import_legacy_login_logs(jsonb,boolean)', 'execute'), 'browser clients cannot import login history');
select ok(has_function_privilege('service_role', 'public.import_legacy_operation_logs(jsonb,boolean)', 'execute'), 'service role can import operation history');
select ok(not has_function_privilege('authenticated', 'public.import_legacy_operation_logs(jsonb,boolean)', 'execute'), 'browser clients cannot import operation history');
select ok(has_function_privilege('service_role', 'public.import_legacy_exception_logs(jsonb,boolean)', 'execute'), 'service role can import exception history');
select ok(not has_function_privilege('authenticated', 'public.import_legacy_exception_logs(jsonb,boolean)', 'execute'), 'browser clients cannot import exception history');

select is(
  public.import_legacy_login_logs(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254741101',
      'user_id', null,
      'login_name', '__codex_import_login',
      'login_ip', '127.0.0.1',
      'user_agent', 'Audit import fixture',
      'login_result', '0',
      'failure_reason', 'INVALID_CREDENTIALS',
      'logged_at', '2026-10-02T10:00:00.000Z'
    )),
    false
  ),
  jsonb_build_object('sourceCount', 1, 'alreadyPresentCount', 0, 'rowsToInsert', 1, 'insertedCount', 0),
  'login import preview leaves the local database unchanged'
);
select ok(not exists (select 1 from public.login_logs where id = 9007199254741101), 'login preview did not insert a row');

select is(
  public.import_legacy_login_logs(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254741101',
      'user_id', null,
      'login_name', '__codex_import_login',
      'login_ip', '127.0.0.1',
      'user_agent', 'Audit import fixture',
      'login_result', '0',
      'failure_reason', 'INVALID_CREDENTIALS',
      'logged_at', '2026-10-02T10:00:00.000Z'
    )),
    true
  ),
  jsonb_build_object('sourceCount', 1, 'alreadyPresentCount', 0, 'rowsToInsert', 1, 'insertedCount', 1),
  'service-role import preserves login result and timestamp'
);
select is(
  public.import_legacy_login_logs(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254741101',
      'user_id', null,
      'login_name', '__codex_import_login',
      'login_ip', '127.0.0.1',
      'user_agent', 'Audit import fixture',
      'login_result', '0',
      'failure_reason', 'INVALID_CREDENTIALS',
      'logged_at', '2026-10-02T10:00:00.000Z'
    )),
    true
  ),
  jsonb_build_object('sourceCount', 1, 'alreadyPresentCount', 1, 'rowsToInsert', 0, 'insertedCount', 0),
  'login import retry is idempotent'
);

select is(
  public.import_legacy_operation_logs(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254741102',
      'operator_id', null,
      'operator_name', 'Historical Operator',
      'module_code', 'USER',
      'operation_type', 'UPDATE',
      'request_method', 'PATCH',
      'request_path', '/users/1',
      'request_params', jsonb_build_object('targetUserId', '9007199254740993'),
      'operation_result', '1',
      'error_message', null,
      'operated_at', '2026-10-02T11:00:00.000Z'
    )), false
  ),
  jsonb_build_object('sourceCount', 1, 'alreadyPresentCount', 0, 'rowsToInsert', 1, 'insertedCount', 0),
  'operation log preview accepts a missing legacy actor when its name snapshot is retained'
);
select is(
  public.import_legacy_operation_logs(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254741102',
      'operator_id', null,
      'operator_name', 'Historical Operator',
      'module_code', 'USER',
      'operation_type', 'UPDATE',
      'request_method', 'PATCH',
      'request_path', '/users/1',
      'request_params', jsonb_build_object('targetUserId', '9007199254740993'),
      'operation_result', '1',
      'error_message', null,
      'operated_at', '2026-10-02T11:00:00.000Z'
    )), true
  ),
  jsonb_build_object('sourceCount', 1, 'alreadyPresentCount', 0, 'rowsToInsert', 1, 'insertedCount', 1),
  'operation import retains actor name and text BIGINT fields'
);
select is(
  (select operator_id from public.operation_logs where id = 9007199254741102),
  null::bigint,
  'unmapped historical actor ID is omitted rather than rounded or fabricated'
);

select is(
  public.import_legacy_exception_logs(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254741103',
      'request_path', '/api/users',
      'request_method', 'POST',
      'error_type', 'Error',
      'error_message', 'sanitized failure',
      'stack_summary', null,
      'handled_status', '0',
      'occurred_at', '2026-10-02T12:00:00.000Z'
    )), true
  ),
  jsonb_build_object('sourceCount', 1, 'alreadyPresentCount', 0, 'rowsToInsert', 1, 'insertedCount', 1),
  'exception import preserves source details and status'
);
select ok(
  (select id::text = '9007199254741103' and occurred_at = '2026-10-02T12:00:00.000Z'::timestamptz
   from public.exception_logs where id = 9007199254741103),
  'exception history preserves its decimal BIGINT ID and timestamp'
);

select throws_ok(
  $$select public.import_legacy_login_logs(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254741104', 'user_id', null,
      'login_name', '__codex_conflict', 'login_ip', null, 'user_agent', null,
      'login_result', '2', 'failure_reason', null, 'logged_at', '2026-10-02T10:00:00Z'
    )), false
  )$$,
  '22023',
  'Legacy login log row is invalid',
  'import rejects invalid login result codes'
);

select * from finish();
rollback;

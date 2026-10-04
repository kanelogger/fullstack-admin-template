-- Read-only inventory before importing login, operation and exception logs.
-- Run only against the explicitly confirmed local source database.

SELECT
  DATABASE() AS database_name,
  @@session.time_zone AS session_time_zone,
  @@global.time_zone AS global_time_zone,
  @@system_time_zone AS system_time_zone,
  CONVERT_TZ('2000-01-01 00:00:00', @@session.time_zone, '+00:00') AS utc_probe;

SELECT
  'login_logs' AS entity,
  COUNT(*) AS total_rows,
  COALESCE(SUM(id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0) AS ids_outside_postgres_bigint,
  COALESCE(SUM(user_id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0) AS actor_ids_outside_postgres_bigint,
  COALESCE(SUM(login_result NOT IN (0, 1)), 0) AS invalid_status_rows,
  COALESCE(SUM(CHAR_LENGTH(login_name) > 64), 0) AS oversized_required_fields,
  0 AS oversized_request_params
FROM login_logs
UNION ALL
SELECT
  'operation_logs',
  COUNT(*),
  COALESCE(SUM(id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(operator_id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(operation_result NOT IN (0, 1)), 0),
  COALESCE(SUM(CHAR_LENGTH(module_code) > 64 OR CHAR_LENGTH(operation_type) > 32
               OR CHAR_LENGTH(request_method) > 16 OR CHAR_LENGTH(request_path) > 255), 0),
  COALESCE(SUM(OCTET_LENGTH(CAST(request_params AS CHAR)) > 3000), 0)
FROM operation_logs
UNION ALL
SELECT
  'exception_logs',
  COUNT(*),
  COALESCE(SUM(id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  0,
  COALESCE(SUM(handled_status NOT IN (0, 1)), 0),
  COALESCE(SUM(CHAR_LENGTH(request_path) > 255 OR CHAR_LENGTH(request_method) > 16
               OR CHAR_LENGTH(error_type) > 128), 0),
  0
FROM exception_logs;

-- Read-only inventory before importing departments and posts into Supabase.
-- Run only against the explicitly confirmed source database. This file has no DDL/DML.

SELECT
  DATABASE() AS database_name,
  @@session.time_zone AS session_time_zone,
  @@global.time_zone AS global_time_zone,
  @@system_time_zone AS system_time_zone;

SELECT
  'departments' AS entity,
  COUNT(*) AS total_rows,
  COALESCE(SUM(id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS ids_outside_postgres_bigint,
  COALESCE(SUM(created_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS creator_ids_outside_postgres_bigint,
  COALESCE(SUM(updated_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS updater_ids_outside_postgres_bigint,
  COALESCE(SUM(status NOT IN (0, 1)), 0) AS invalid_status_rows,
  COALESCE(SUM(TRIM(COALESCE(dept_code, '')) = ''), 0) AS empty_code_rows,
  COALESCE(SUM(CHAR_LENGTH(dept_code) > 64), 0) AS oversized_code_rows,
  COALESCE(SUM(CHAR_LENGTH(dept_name) > 128), 0) AS oversized_name_rows,
  COALESCE(SUM(CHAR_LENGTH(description) > 255), 0) AS oversized_description_rows
FROM departments
UNION ALL
SELECT
  'posts',
  COUNT(*),
  COALESCE(SUM(id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(created_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(updated_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(status NOT IN (0, 1)), 0),
  COALESCE(SUM(TRIM(COALESCE(post_code, '')) = ''), 0),
  COALESCE(SUM(CHAR_LENGTH(post_code) > 64), 0),
  COALESCE(SUM(CHAR_LENGTH(post_name) > 128), 0),
  COALESCE(SUM(CHAR_LENGTH(description) > 255), 0)
FROM posts;

-- MySQL's default utf8mb4_unicode_ci unique keys are case-insensitive.
SELECT LOWER(TRIM(dept_code)) AS normalized_code, COUNT(*) AS row_count,
       GROUP_CONCAT(id ORDER BY id) AS source_ids
FROM departments
GROUP BY LOWER(TRIM(dept_code))
HAVING COUNT(*) > 1
ORDER BY normalized_code;

SELECT LOWER(TRIM(post_code)) AS normalized_code, COUNT(*) AS row_count,
       GROUP_CONCAT(id ORDER BY id) AS source_ids
FROM posts
GROUP BY LOWER(TRIM(post_code))
HAVING COUNT(*) > 1
ORDER BY normalized_code;

-- Existing profile mappings must have source rows before they can be enforced by Postgres FKs.
SELECT
  COALESCE(SUM(legacy_user.dept_id IS NOT NULL AND department.id IS NULL), 0)
    AS users_with_missing_department,
  COALESCE(SUM(legacy_user.post_id IS NOT NULL AND post.id IS NULL), 0)
    AS users_with_missing_post
FROM users AS legacy_user
LEFT JOIN departments AS department ON department.id = legacy_user.dept_id
LEFT JOIN posts AS post ON post.id = legacy_user.post_id;

-- IDs referenced by profiles must fit PostgreSQL's signed BIGINT range.
SELECT id, dept_id, post_id
FROM users
WHERE dept_id > CAST('9223372036854775807' AS DECIMAL(20, 0))
   OR post_id > CAST('9223372036854775807' AS DECIMAL(20, 0))
ORDER BY id;

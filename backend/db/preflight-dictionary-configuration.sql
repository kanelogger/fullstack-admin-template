-- Read-only inventory before importing dictionary/configuration data.
-- Run only against the explicitly confirmed source database. This file has no DDL/DML.

SELECT
  DATABASE() AS database_name,
  @@session.time_zone AS session_time_zone,
  @@global.time_zone AS global_time_zone,
  @@system_time_zone AS system_time_zone;

SELECT
  'dict_types' AS entity,
  COUNT(*) AS total_rows,
  COALESCE(SUM(id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS ids_outside_postgres_bigint,
  COALESCE(SUM(created_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS creator_ids_outside_postgres_bigint,
  COALESCE(SUM(updated_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS updater_ids_outside_postgres_bigint,
  COALESCE(SUM(status NOT IN (0, 1)), 0) AS invalid_status_rows,
  COALESCE(SUM(TRIM(COALESCE(dict_code, '')) = ''), 0) AS empty_code_rows,
  COALESCE(SUM(CHAR_LENGTH(dict_code) > 64), 0) AS oversized_code_rows,
  COALESCE(SUM(CHAR_LENGTH(dict_name) > 128), 0) AS oversized_name_rows,
  COALESCE(SUM(CHAR_LENGTH(description) > 255), 0) AS oversized_description_rows
FROM dict_types
UNION ALL
SELECT
  'dict_items',
  COUNT(*),
  COALESCE(SUM(id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(created_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(updated_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(status NOT IN (0, 1)), 0),
  COALESCE(SUM(TRIM(COALESCE(item_value, '')) = ''), 0),
  COALESCE(SUM(CHAR_LENGTH(item_value) > 64), 0),
  COALESCE(SUM(CHAR_LENGTH(item_label) > 128), 0),
  COALESCE(SUM(CHAR_LENGTH(description) > 255), 0)
FROM dict_items
UNION ALL
SELECT
  'system_configs',
  COUNT(*),
  COALESCE(SUM(id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(created_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(updated_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0),
  COALESCE(SUM(status NOT IN (0, 1)), 0),
  COALESCE(SUM(TRIM(COALESCE(config_code, '')) = ''), 0),
  COALESCE(SUM(CHAR_LENGTH(config_code) > 64), 0),
  COALESCE(SUM(CHAR_LENGTH(config_name) > 128), 0),
  COALESCE(SUM(CHAR_LENGTH(description) > 255), 0)
FROM system_configs;

SELECT value_type, COUNT(*) AS row_count
FROM system_configs
GROUP BY value_type
ORDER BY value_type;

SELECT
  COALESCE(SUM(TRIM(COALESCE(config_value, '')) = ''), 0) AS empty_config_values,
  COALESCE(SUM(UPPER(TRIM(value_type)) NOT IN ('STRING', 'NUMBER', 'BOOLEAN', 'JSON')), 0)
    AS unrecognized_value_types
FROM system_configs;

SELECT id, dict_type_id
FROM dict_items
WHERE dict_type_id > CAST('9223372036854775807' AS DECIMAL(20, 0))
ORDER BY id;

SELECT
  COALESCE(SUM(dictionary_type.id IS NULL), 0) AS items_with_missing_type,
  COALESCE(SUM(item.created_by IS NOT NULL AND creator.id IS NULL), 0)
    AS items_with_missing_creator,
  COALESCE(SUM(item.updated_by IS NOT NULL AND updater.id IS NULL), 0)
    AS items_with_missing_updater
FROM dict_items AS item
LEFT JOIN dict_types AS dictionary_type ON dictionary_type.id = item.dict_type_id
LEFT JOIN users AS creator ON creator.id = item.created_by
LEFT JOIN users AS updater ON updater.id = item.updated_by;

SELECT
  COALESCE(SUM(config.created_by IS NOT NULL AND creator.id IS NULL), 0)
    AS configs_with_missing_creator,
  COALESCE(SUM(config.updated_by IS NOT NULL AND updater.id IS NULL), 0)
    AS configs_with_missing_updater
FROM system_configs AS config
LEFT JOIN users AS creator ON creator.id = config.created_by
LEFT JOIN users AS updater ON updater.id = config.updated_by;

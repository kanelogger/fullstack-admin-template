-- Read-only inventory before copying the legacy inbox into Supabase.
-- Run only against the explicitly confirmed, dedicated source database.
-- This file contains no DDL or DML.

SELECT
  DATABASE() AS database_name,
  @@session.time_zone AS session_time_zone,
  @@global.time_zone AS global_time_zone,
  @@system_time_zone AS system_time_zone;

SELECT
  COUNT(*) AS total_messages,
  COALESCE(SUM(read_status NOT IN (0, 1)), 0) AS invalid_read_status_rows,
  COALESCE(SUM(receiver_id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS receiver_id_outside_postgres_bigint,
  COALESCE(SUM(sender_id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS sender_id_outside_postgres_bigint,
  COALESCE(SUM(id > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS message_id_outside_postgres_bigint,
  COALESCE(SUM(created_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS created_by_outside_postgres_bigint,
  COALESCE(SUM(updated_by > CAST('9223372036854775807' AS DECIMAL(20, 0))), 0)
    AS updated_by_outside_postgres_bigint,
  COALESCE(SUM(read_status = 1 AND read_at IS NULL), 0)
    AS read_rows_without_read_at,
  COALESCE(SUM(read_status = 0 AND read_at IS NOT NULL), 0)
    AS unread_rows_with_read_at
FROM messages;

SELECT message_type, COUNT(*) AS rows_for_type
FROM messages
GROUP BY message_type
ORDER BY message_type;

SELECT
  COALESCE(SUM(receiver.id IS NULL), 0) AS missing_receiver_profiles,
  COALESCE(SUM(m.sender_id IS NOT NULL AND sender.id IS NULL), 0) AS missing_sender_profiles,
  COALESCE(SUM(m.created_by IS NOT NULL AND creator.id IS NULL), 0) AS missing_creator_profiles,
  COALESCE(SUM(m.updated_by IS NOT NULL AND updater.id IS NULL), 0) AS missing_updater_profiles
FROM messages AS m
LEFT JOIN users AS receiver ON receiver.id = m.receiver_id
LEFT JOIN users AS sender ON sender.id = m.sender_id
LEFT JOIN users AS creator ON creator.id = m.created_by
LEFT JOIN users AS updater ON updater.id = m.updated_by;

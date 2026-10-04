-- Read-only account report before creating Supabase Auth users.
-- Run only against the confirmed legacy source database; this file does not write.

-- Active accounts whose login names are empty.
SELECT id, login_name
FROM users
WHERE status = 1
  AND deleted = 0
  AND TRIM(COALESCE(login_name, '')) = ''
ORDER BY id;

-- Active accounts that need a valid, verified email before Auth provisioning.
SELECT id, login_name, email
FROM users
WHERE status = 1
  AND deleted = 0
  AND (
    TRIM(COALESCE(email, '')) = ''
    OR email NOT REGEXP '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  )
ORDER BY id;

-- Case-insensitive duplicate login names.
SELECT LOWER(TRIM(login_name)) AS normalized_login_name, COUNT(*) AS account_count,
       GROUP_CONCAT(id ORDER BY id) AS user_ids
FROM users
WHERE status = 1 AND deleted = 0
GROUP BY LOWER(TRIM(login_name))
HAVING COUNT(*) > 1
ORDER BY normalized_login_name;

-- Case-insensitive duplicate emails.
SELECT LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS account_count,
       GROUP_CONCAT(id ORDER BY id) AS user_ids
FROM users
WHERE status = 1 AND deleted = 0 AND TRIM(COALESCE(email, '')) <> ''
GROUP BY LOWER(TRIM(email))
HAVING COUNT(*) > 1
ORDER BY normalized_email;

-- PostgreSQL BIGINT cannot preserve MySQL BIGINT UNSIGNED values above its
-- signed maximum. These rows require an explicit migration decision.
SELECT id, login_name
FROM users
WHERE id > 9223372036854775807
ORDER BY id;

-- The temporary Fastify bridge currently stores userId as a JavaScript number.
-- IDs above this limit can authenticate only after the legacy API is retired or
-- every old route is migrated to decimal-string identifiers.
SELECT id, login_name
FROM users
WHERE id > 9007199254740991
ORDER BY id;

-- Candidate rows to provision after all previous result sets are empty and
-- email ownership/verification has been confirmed by the account owner.
SELECT id, login_name, display_name, email
FROM users
WHERE status = 1 AND deleted = 0
ORDER BY id;

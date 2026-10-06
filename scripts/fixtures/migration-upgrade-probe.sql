-- Test-only user data. This file is executed directly by the upgrade checker
-- and is never placed in supabase/migrations or the migration ledger.
insert into public.system_configs (
  config_code,
  config_name,
  config_value,
  value_type,
  description
)
values (
  '__UPGRADE_PROBE_CODE__',
  'Migration upgrade preservation probe',
  'must-survive-pending-migrations',
  'STRING',
  'Temporary test data; deleted before final schema comparison.'
);

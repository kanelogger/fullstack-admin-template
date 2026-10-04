begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  has_function_privilege('service_role', 'public.import_legacy_attachments(jsonb,boolean)', 'execute'),
  'service_role can import legacy attachment metadata'
);
select ok(
  not has_function_privilege('authenticated', 'public.import_legacy_attachments(jsonb,boolean)', 'execute'),
  'authenticated clients cannot import legacy attachments'
);
select ok(
  not has_function_privilege('anon', 'public.import_legacy_attachments(jsonb,boolean)', 'execute'),
  'anonymous clients cannot import legacy attachments'
);
select ok(
  has_column_privilege('service_role', 'public.attachments', 'id', 'insert'),
  'trusted local import code can preserve attachment IDs'
);
select ok(
  not has_column_privilege('authenticated', 'public.attachments', 'id', 'insert'),
  'browser clients cannot bypass the attachment metadata RPC'
);

select is(
  public.import_legacy_attachments(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254740997',
      'original_name', 'legacy.txt',
      'storage_path', 'legacy/9007199254740997/legacy.txt',
      'mime_type', 'text/plain',
      'file_ext', 'txt',
      'file_size', '16',
      'business_module', 'PROJECT',
      'business_record_id', null,
      'reference_status', '1',
      'upload_user_id', '910000000000003',
      'uploaded_at', '2026-10-02T10:00:00.000Z',
      'created_by', null,
      'created_at', '2026-10-02T09:00:00.000Z',
      'updated_by', '910000000000003',
      'updated_at', '2026-10-02T10:00:00.000Z',
      'deleted', false
    )),
    false
  ),
  jsonb_build_object('sourceCount', 1, 'alreadyPresentCount', 0, 'rowsToInsert', 1, 'insertedCount', 0),
  'legacy metadata preview reports rows without writing them'
);
select ok(
  not exists (select 1 from public.attachments where id = 9007199254740997),
  'legacy attachment preview does not write a row'
);

select throws_ok(
  $$select public.import_legacy_attachments('null'::jsonb, false)$$,
  '22023',
  'Attachment import input must be a JSON array',
  'import rejects non-array input'
);
select throws_ok(
  $$select public.import_legacy_attachments(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254740998',
      'original_name', 'legacy.txt',
      'storage_path', 'legacy/9007199254740998/legacy.txt',
      'mime_type', 'text/plain',
      'file_ext', 'txt',
      'file_size', '20971521',
      'business_module', null,
      'business_record_id', null,
      'reference_status', '0',
      'upload_user_id', '910000000000003',
      'uploaded_at', '2026-10-02T10:00:00.000Z',
      'created_by', null,
      'created_at', '2026-10-02T09:00:00.000Z',
      'updated_by', null,
      'updated_at', '2026-10-02T10:00:00.000Z',
      'deleted', false
    )), false
  )$$,
  '22023',
  'Legacy attachment row is invalid',
  'import rejects a file larger than the private bucket limit'
);
select throws_ok(
  $$select public.import_legacy_attachments(
    jsonb_build_array(jsonb_build_object(
      'id', '9007199254740999',
      'original_name', 'missing.txt',
      'storage_path', 'legacy/9007199254740999/missing.txt',
      'mime_type', 'text/plain',
      'file_ext', 'txt',
      'file_size', '16',
      'business_module', null,
      'business_record_id', null,
      'reference_status', '0',
      'upload_user_id', '910000000000003',
      'uploaded_at', '2026-10-02T10:00:00.000Z',
      'created_by', null,
      'created_at', '2026-10-02T09:00:00.000Z',
      'updated_by', null,
      'updated_at', '2026-10-02T10:00:00.000Z',
      'deleted', false
    )), true
  )$$,
  '23503',
  'An active legacy attachment object is missing from private Storage',
  'applying metadata is rejected until its binary exists in private Storage'
);
select ok(
  not exists (select 1 from public.attachments where id in (9007199254740998, 9007199254740999)),
  'invalid and incomplete imports do not write metadata'
);

select * from finish();
rollback;

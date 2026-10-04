begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

select has_table('public', 'attachments', 'attachment metadata table exists');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.attachments'::regclass),
  'attachment metadata enables row-level security'
);
select ok(not has_table_privilege('anon', 'public.attachments', 'select'), 'anonymous clients cannot read attachment metadata');
select ok(has_table_privilege('authenticated', 'public.attachments', 'select'), 'authenticated reads are controlled by metadata RLS');
select ok(not has_table_privilege('authenticated', 'public.attachments', 'insert'), 'clients cannot insert metadata directly');
select ok(not has_table_privilege('authenticated', 'public.attachments', 'delete'), 'clients cannot hard-delete metadata directly');
select ok(has_table_privilege('service_role', 'public.attachments', 'delete'), 'trusted server code can clean attachment metadata');
select ok(
  (select reloptions @> array['security_invoker=true'] from pg_catalog.pg_class where oid = 'public.attachment_read_model'::regclass),
  'attachment read model invokes underlying RLS'
);
select ok(has_table_privilege('authenticated', 'public.attachment_read_model', 'select'), 'authenticated clients can query the RLS read model');
select ok(not has_table_privilege('anon', 'public.attachment_read_model', 'select'), 'anonymous clients cannot query the attachment read model');
select ok(exists (select 1 from storage.buckets where id = 'admin-attachments'), 'private attachment bucket exists');
select ok((select public = false from storage.buckets where id = 'admin-attachments'), 'attachment bucket is private');
select is((select file_size_limit from storage.buckets where id = 'admin-attachments'), 20971520::bigint, 'bucket enforces the 20 MiB upload limit');
select is(
  (select count(*)::integer from public.permission_catalog where permission_key in (
    'files.attachments.read', 'files.attachments.upload', 'files.attachments.delete'
  )),
  3,
  'read, upload and delete permissions are separately registered'
);
select ok(has_function_privilege('authenticated', 'public.create_attachment_metadata(text,text,text,text,bigint,text,bigint)', 'execute'), 'authenticated callers can invoke the permission-checked metadata API');
select ok(not has_function_privilege('anon', 'public.create_attachment_metadata(text,text,text,text,bigint,text,bigint)', 'execute'), 'anonymous callers cannot invoke metadata creation');
select ok(has_function_privilege('authenticated', 'public.attachment_storage_path_for_delete(bigint)', 'execute'), 'authenticated callers can resolve a deletable object path');
select ok(not has_function_privilege('anon', 'public.attachment_storage_path_for_delete(bigint)', 'execute'), 'anonymous callers cannot resolve object paths');
select ok(has_function_privilege('authenticated', 'public.delete_attachment_metadata(bigint)', 'execute'), 'authenticated callers can invoke the permission-checked metadata delete');
select ok(not has_function_privilege('anon', 'public.delete_attachment_metadata(bigint)', 'execute'), 'anonymous callers cannot invoke metadata deletion');
select ok(has_function_privilege('authenticated', 'app_private.can_delete_attachment_path(text)', 'execute'), 'authenticated Storage policies can check attachment deletes');
select ok(not has_function_privilege('anon', 'app_private.can_delete_attachment_path(text)', 'execute'), 'anonymous clients cannot invoke the Storage delete helper');
select ok(has_function_privilege('authenticated', 'app_private.can_cleanup_unregistered_attachment_upload(text)', 'execute'), 'authenticated Storage policies can clean their own unregistered uploads');
select ok(not has_function_privilege('anon', 'app_private.can_cleanup_unregistered_attachment_upload(text)', 'execute'), 'anonymous clients cannot invoke the upload cleanup helper');

select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', profile.auth_user_id::text,
      'role', 'authenticated',
      'session_id', (
        select allowed_session.session_id::text
        from app_private.account_password_sessions as allowed_session
        where allowed_session.auth_user_id = profile.auth_user_id
        order by allowed_session.authorized_at desc limit 1
      ),
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))
    )::text
    from public.profiles as profile where profile.login_name = '__codex_rls_super'
  ),
  true
);
set local role authenticated;
select ok(app_private.is_password_authenticated(), 'SUPER_ADMIN fixture has a registered password session');
select ok(app_private.has_permission('files.attachments.read'), 'SUPER_ADMIN can read attachments');
select ok(app_private.has_permission('files.attachments.upload'), 'SUPER_ADMIN can upload attachments');
select ok(app_private.has_permission('files.attachments.delete'), 'SUPER_ADMIN can delete attachments');
select throws_ok(
  $$select public.create_attachment_metadata(
    'missing.txt', '910000000000003/00000000-0000-4000-8000-000000000000.txt',
    'text/plain', 'txt', 3, null, null
  )$$,
  '23503',
  'Uploaded storage object is missing',
  'metadata cannot reference an absent private object'
);
reset role;

select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', profile.auth_user_id::text,
      'role', 'authenticated',
      'session_id', (
        select allowed_session.session_id::text
        from app_private.account_password_sessions as allowed_session
        where allowed_session.auth_user_id = profile.auth_user_id
        order by allowed_session.authorized_at desc limit 1
      ),
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))
    )::text
    from public.profiles as profile where profile.login_name = '__codex_rls_operator'
  ),
  true
);
set local role authenticated;
select ok(app_private.has_permission('files.attachments.read'), 'OPERATOR fixture can read the authorized attachment module');
select ok(not app_private.has_permission('files.attachments.upload'), 'OPERATOR has no upload permission by default');
select ok(not app_private.has_permission('files.attachments.delete'), 'OPERATOR has no delete permission by default');
select throws_ok(
  $$select public.delete_attachment_metadata(1)$$,
  '42501',
  'Attachment delete permission is required',
  'OPERATOR cannot delete metadata without its write permission'
);
select throws_ok(
  $$select public.create_attachment_metadata(null, null, null, null, null, null, null)$$,
  '42501',
  'Attachment upload permission is required',
  'OPERATOR cannot upload metadata without its write permission'
);
reset role;

select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object(
      'sub', profile.auth_user_id::text,
      'role', 'authenticated',
      'session_id', (
        select allowed_session.session_id::text
        from app_private.account_password_sessions as allowed_session
        where allowed_session.auth_user_id = profile.auth_user_id
        order by allowed_session.authorized_at desc limit 1
      ),
      'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1))
    )::text
    from public.profiles as profile where profile.login_name = '__codex_rls_common'
  ),
  true
);
set local role authenticated;
select ok(not app_private.has_permission('files.attachments.read'), 'COMMON_USER cannot read the attachment module');
select ok(not app_private.has_permission('files.attachments.upload'), 'COMMON_USER cannot upload attachments');
select ok(not app_private.has_permission('files.attachments.delete'), 'COMMON_USER cannot delete attachments');
select throws_ok(
  $$select public.create_attachment_metadata(null, null, null, null, null, null, null)$$,
  '42501',
  'Attachment upload permission is required',
  'COMMON_USER cannot create attachment metadata'
);

select * from finish();
rollback;

select jsonb_build_object(
  'schemas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', namespace.nspname,
      'owner', owner.rolname,
      'acl', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'grantor', grantor.rolname,
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        ) order by grantor.rolname, grantee.rolname nulls first, acl.privilege_type, acl.is_grantable), '[]'::jsonb)
        from aclexplode(coalesce(namespace.nspacl, acldefault('n'::"char", namespace.nspowner))) as acl
        join pg_roles grantor on grantor.oid = acl.grantor
        left join pg_roles grantee on grantee.oid = acl.grantee
      )
    ) order by namespace.nspname), '[]'::jsonb)
    from pg_namespace namespace
    join pg_roles owner on owner.oid = namespace.nspowner
    where namespace.nspname in ('public', 'app_private', 'storage')
  ),
  'default_privileges', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'grantor', grantor.rolname,
      'owner', owner.rolname,
      'object_type', defaults.defaclobjtype,
      'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
      'privilege', acl.privilege_type,
      'grantable', acl.is_grantable
    ) order by namespace.nspname, defaults.defaclobjtype, grantor.rolname, owner.rolname, grantee.rolname nulls first, acl.privilege_type), '[]'::jsonb)
    from pg_default_acl defaults
    join pg_roles grantor on grantor.oid = defaults.defaclrole
    left join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) acl
    left join pg_roles grantee on grantee.oid = acl.grantee
    left join pg_roles owner on owner.oid = acl.grantor
    where namespace.nspname in ('public', 'app_private', 'storage')
       or defaults.defaclnamespace = 0
  ),
  'relations', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'name', relation.relname,
      'kind', relation.relkind,
      'owner', owner.rolname,
      'row_security', relation.relrowsecurity,
      'force_row_security', relation.relforcerowsecurity,
      'options', coalesce(relation.reloptions, array[]::text[]),
      'acl', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'grantor', grantor.rolname,
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        ) order by grantor.rolname, grantee.rolname nulls first, acl.privilege_type, acl.is_grantable), '[]'::jsonb)
        from aclexplode(coalesce(relation.relacl, acldefault(case when relation.relkind = 'S' then 's'::"char" else 'r'::"char" end, relation.relowner))) acl
        join pg_roles grantor on grantor.oid = acl.grantor
        left join pg_roles grantee on grantee.oid = acl.grantee
      )
    ) order by namespace.nspname, relation.relname), '[]'::jsonb)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_roles owner on owner.oid = relation.relowner
    where namespace.nspname in ('public', 'app_private', 'storage')
      and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      and not exists (
        select 1 from pg_depend dependency
        where dependency.classid = 'pg_class'::regclass
          and dependency.objid = relation.oid
          and dependency.deptype = 'e'
      )
  ),
  'sequences', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'name', sequence.relname,
      'type', format_type(settings.seqtypid, null),
      'start', settings.seqstart,
      'increment', settings.seqincrement,
      'minimum', settings.seqmin,
      'maximum', settings.seqmax,
      'cache', settings.seqcache,
      'cycle', settings.seqcycle
    ) order by namespace.nspname, sequence.relname), '[]'::jsonb)
    from pg_class sequence
    join pg_namespace namespace on namespace.oid = sequence.relnamespace
    join pg_sequence settings on settings.seqrelid = sequence.oid
    where namespace.nspname in ('public', 'app_private', 'storage')
      and sequence.relkind = 'S'
  ),
  'views', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'name', relation.relname,
      'kind', relation.relkind,
      'definition', pg_get_viewdef(relation.oid, true),
      'options', coalesce(relation.reloptions, array[]::text[])
    ) order by namespace.nspname, relation.relname), '[]'::jsonb)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'app_private', 'storage')
      and relation.relkind in ('v', 'm')
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'table', relation.relname,
      'name', trigger.tgname,
      'definition', pg_get_triggerdef(trigger.oid, true),
      'enabled', trigger.tgenabled,
      'constraint_trigger', trigger.tgconstraint <> 0,
      'deferrable', trigger.tgdeferrable,
      'initially_deferred', trigger.tginitdeferred
    ) order by namespace.nspname, relation.relname, trigger.tgname), '[]'::jsonb)
    from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'app_private', 'storage')
      and not trigger.tgisinternal
  ),
  'types', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'name', type_row.typname,
      'kind', type_row.typtype,
      'definition', format_type(type_row.oid, null),
      'domain_not_null', type_row.typnotnull,
      'enum_labels', coalesce((
        select jsonb_agg(enum_value.enumlabel order by enum_value.enumsortorder)
        from pg_enum enum_value
        where enum_value.enumtypid = type_row.oid
      ), '[]'::jsonb)
    ) order by namespace.nspname, type_row.typname), '[]'::jsonb)
    from pg_type type_row
    join pg_namespace namespace on namespace.oid = type_row.typnamespace
    where namespace.nspname in ('public', 'app_private', 'storage')
      and type_row.typtype in ('d', 'e')
  ),
  'domain_constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'domain', type_row.typname,
      'name', constraint_row.conname,
      'definition', regexp_replace(replace(pg_get_constraintdef(constraint_row.oid, true), '"', ''), '\s+', '', 'g'),
      'validated', constraint_row.convalidated
    ) order by namespace.nspname, type_row.typname, constraint_row.conname), '[]'::jsonb)
    from pg_constraint constraint_row
    join pg_type type_row on type_row.oid = constraint_row.contypid
    join pg_namespace namespace on namespace.oid = type_row.typnamespace
    where namespace.nspname in ('public', 'app_private', 'storage')
  ),
  'collations', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'name', collation_row.collname,
      'provider', collation_row.collprovider,
      'deterministic', collation_row.collisdeterministic,
      'locale', collation_row.colllocale,
      'collate', collation_row.collcollate,
      'ctype', collation_row.collctype
    ) order by namespace.nspname, collation_row.collname), '[]'::jsonb)
    from pg_collation collation_row
    join pg_namespace namespace on namespace.oid = collation_row.collnamespace
    where namespace.nspname in ('public', 'app_private', 'storage')
  ),
  'columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'table', relation.relname,
      'position', attribute.attnum,
      'name', attribute.attname,
      'type', format_type(attribute.atttypid, attribute.atttypmod),
      'not_null', attribute.attnotnull,
      'default', pg_get_expr(default_value.adbin, default_value.adrelid),
      'identity', attribute.attidentity,
      'generated', attribute.attgenerated,
      'collation', collation_row.collname,
      'acl', coalesce((
        select jsonb_agg(jsonb_build_object(
          'grantor', grantor.rolname,
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        ) order by grantor.rolname, grantee.rolname nulls first, acl.privilege_type)
        from aclexplode(attribute.attacl) acl
        join pg_roles grantor on grantor.oid = acl.grantor
        left join pg_roles grantee on grantee.oid = acl.grantee
      ), '[]'::jsonb)
    ) order by namespace.nspname, relation.relname, attribute.attnum), '[]'::jsonb)
    from pg_attribute attribute
    join pg_class relation on relation.oid = attribute.attrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    left join pg_attrdef default_value on default_value.adrelid = relation.oid and default_value.adnum = attribute.attnum
    left join pg_collation collation_row on collation_row.oid = attribute.attcollation
    where namespace.nspname in ('public', 'app_private', 'storage')
      and relation.relkind in ('r', 'p', 'v', 'm', 'f')
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'table', relation.relname,
      'name', constraint_row.conname,
      'type', constraint_row.contype,
      'definition', regexp_replace(replace(pg_get_constraintdef(constraint_row.oid, true), '"', ''), '\s+', '', 'g'),
      'validated', constraint_row.convalidated,
      'deferrable', constraint_row.condeferrable,
      'initially_deferred', constraint_row.condeferred
    ) order by namespace.nspname, relation.relname, constraint_row.conname), '[]'::jsonb)
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'app_private', 'storage')
  ),
  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'table', relation.relname,
      'name', index_relation.relname,
      'definition', pg_get_indexdef(index_relation.oid),
      'valid', index_row.indisvalid,
      'ready', index_row.indisready
    ) order by namespace.nspname, relation.relname, index_relation.relname), '[]'::jsonb)
    from pg_index index_row
    join pg_class relation on relation.oid = index_row.indrelid
    join pg_class index_relation on index_relation.oid = index_row.indexrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'app_private', 'storage')
  ),
  'routines', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', namespace.nspname,
      'name', routine.proname,
      'identity_arguments', pg_get_function_identity_arguments(routine.oid),
      'definition', pg_get_functiondef(routine.oid),
      'security_definer', routine.prosecdef,
      'volatility', routine.provolatile,
      'configuration', coalesce(routine.proconfig, array[]::text[]),
      'owner', owner.rolname,
      'acl', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'grantor', grantor.rolname,
          'grantee', case when acl.grantee = 0 then 'PUBLIC' else grantee.rolname end,
          'privilege', acl.privilege_type,
          'grantable', acl.is_grantable
        ) order by grantor.rolname, grantee.rolname nulls first, acl.privilege_type), '[]'::jsonb)
        from aclexplode(coalesce(routine.proacl, acldefault('f'::"char", routine.proowner))) acl
        join pg_roles grantor on grantor.oid = acl.grantor
        left join pg_roles grantee on grantee.oid = acl.grantee
      )
    ) order by namespace.nspname, routine.proname, pg_get_function_identity_arguments(routine.oid)), '[]'::jsonb)
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    join pg_roles owner on owner.oid = routine.proowner
    where namespace.nspname in ('public', 'app_private', 'storage')
      and routine.prokind in ('f', 'p')
      and not exists (
        select 1 from pg_depend dependency
        where dependency.classid = 'pg_proc'::regclass
          and dependency.objid = routine.oid
          and dependency.deptype = 'e'
      )
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname,
      'table', tablename,
      'name', policyname,
      'command', cmd,
      'roles', roles,
      'using', qual,
      'check', with_check
    ) order by schemaname, tablename, policyname), '[]'::jsonb)
    from pg_policies
    where schemaname in ('public', 'app_private', 'storage')
  ),
  'storage_buckets', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'name', name,
      'public', public,
      'file_size_limit', file_size_limit,
      'allowed_mime_types', allowed_mime_types
    ) order by id), '[]'::jsonb)
    from storage.buckets
    where id = 'admin-attachments'
  ),
  'realtime_publication', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'publication', pubname,
      'schema', schemaname,
      'table', tablename
    ) order by pubname, schemaname, tablename), '[]'::jsonb)
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname in ('public', 'app_private')
  ),
  'seed', jsonb_build_object(
    'roles', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'description', description, 'is_system', is_system, 'is_active', is_active
      ) order by code), '[]'::jsonb) from public.roles
    ),
    'permissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'permission_key', permission_key, 'description', description
      ) order by permission_key), '[]'::jsonb) from public.permission_catalog
    ),
    'role_permissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role', role.code, 'permission_key', permission.permission_key
      ) order by role.code, permission.permission_key), '[]'::jsonb)
      from public.role_permissions permission
      join public.roles role on role.id = permission.role_id
    ),
    'menus', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'parent_id', parent_id, 'kind', kind, 'route_key', route_key,
        'path', path, 'title', title, 'icon', icon, 'sort_order', sort_order,
        'is_visible', is_visible, 'is_active', is_active, 'required_permission_key', required_permission_key
      ) order by id), '[]'::jsonb) from public.menus
    )
  )
)::text;

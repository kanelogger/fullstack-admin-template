-- Add an optional, cycle-safe parent relationship for organization departments.
-- Existing directory rows and profile.department_id mappings remain unchanged.
alter table public.departments
  add column parent_id bigint,
  add constraint departments_parent_id_fkey
    foreign key (parent_id) references public.departments(id) on delete restrict,
  add constraint departments_not_own_parent
    check (parent_id is distinct from id);

create index departments_parent_id_idx
  on public.departments (parent_id)
  where parent_id is not null;

comment on column public.departments.parent_id is
  'Optional parent department. Active department hierarchies must be acyclic.';

-- The trigger-only definer checks the complete parent chain even when the
-- authenticated caller has write permission without read permission. It
-- returns no rows; client writes remain governed by the existing RLS policies.
create function app_private.guard_department_parent_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hierarchy_has_cycle boolean := false;
  hierarchy_has_deleted_ancestor boolean := false;
begin
  if (select auth.uid()) is null
    and coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
    and session_user not in ('postgres', 'supabase_admin') then
    raise exception using errcode = '42501', message = 'Department hierarchy writes require an authenticated session';
  end if;

  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception using errcode = '23514', message = 'Department cannot be its own parent';
  end if;

  -- Serialize hierarchy edits so concurrent parent changes cannot each pass
  -- a cycle check against a conflicting in-flight tree mutation.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.departments.parent_id', 0)
  );

  perform 1
  from public.departments as parent
  where parent.id = new.parent_id and not parent.deleted
  for key share;
  if not found then
    raise exception using errcode = '23503', message = 'Parent department is missing or deleted';
  end if;

  with recursive parent_chain(id, parent_id, deleted, visited) as (
    select parent.id, parent.parent_id, parent.deleted, array[parent.id]::bigint[]
    from public.departments as parent
    where parent.id = new.parent_id

    union all

    select parent.id, parent.parent_id, parent.deleted, chain.visited || parent.id
    from parent_chain as chain
    join public.departments as parent on parent.id = chain.parent_id
    where not parent.id = any(chain.visited)
  )
  select
    coalesce(bool_or(chain.id = new.id), false),
    coalesce(bool_or(chain.deleted), false)
  into hierarchy_has_cycle, hierarchy_has_deleted_ancestor
  from parent_chain as chain;

  if hierarchy_has_cycle then
    raise exception using errcode = '23514', message = 'Department hierarchy cannot contain a cycle';
  end if;
  if hierarchy_has_deleted_ancestor then
    raise exception using errcode = '23503', message = 'Parent hierarchy contains a deleted department';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_department_parent_hierarchy()
  from public, anon, authenticated, service_role;

create trigger departments_guard_parent_hierarchy
before insert or update of parent_id on public.departments
for each row execute function app_private.guard_department_parent_hierarchy();

create or replace view public.department_read_model
with (security_invoker = true)
as
select
  department.id::text as id,
  department.dept_code,
  department.dept_name,
  department.status,
  department.description,
  department.created_at,
  department.updated_at,
  department.parent_id::text as parent_id
from public.departments as department
where not department.deleted;

grant insert (parent_id) on public.departments to authenticated;
grant update (parent_id) on public.departments to authenticated;

-- Soft deletion must not leave active child departments orphaned.
create or replace function public.delete_department(p_department_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id bigint;
begin
  if not app_private.is_password_authenticated()
    or not app_private.has_permission('organization.departments.delete') then
    raise exception using errcode = '42501', message = 'Department delete permission is required';
  end if;
  if p_department_id is null or p_department_id !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '22023', message = 'Department ID is invalid';
  end if;
  if p_department_id::numeric > 9223372036854775807 then
    raise exception using errcode = '22023', message = 'Department ID exceeds PostgreSQL BIGINT range';
  end if;

  target_id := p_department_id::bigint;
  perform 1 from public.departments
  where id = target_id and not deleted
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Department was not found';
  end if;
  if exists (
    select 1 from public.profiles as profile
    where profile.department_id = target_id
  ) then
    raise exception using errcode = '23503', message = 'Department is referenced by profiles';
  end if;
  if exists (
    select 1 from public.departments as child
    where child.parent_id = target_id and not child.deleted
  ) then
    raise exception using errcode = '23503', message = 'Department has active child departments';
  end if;

  update public.departments
  set deleted = true
  where id = target_id and not deleted;
  return true;
end;
$$;

-- Keep the role-management RPC aligned with the migration contract: remove
-- owned permission links before deleting an unassigned role.
create or replace function public.delete_admin_role(p_role_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.roles%rowtype;
begin
  if p_role_id is null then
    raise exception using errcode = '22023', message = 'Role ID is required';
  end if;
  if not app_private.has_permission('administration.roles.delete') then
    raise exception using errcode = '42501', message = 'Role delete permission is required';
  end if;

  select * into target_role
  from public.roles as role
  where role.id = p_role_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Role was not found';
  end if;
  if target_role.is_system then
    raise exception using errcode = '23514', message = 'System roles cannot be deleted';
  end if;
  if exists (select 1 from public.user_roles as user_role where user_role.role_id = p_role_id) then
    raise exception using errcode = '23503', message = 'Role is assigned to users';
  end if;

  delete from public.role_permissions as role_permission
  where role_permission.role_id = p_role_id;
  delete from public.roles as role where role.id = p_role_id;
end;
$$;

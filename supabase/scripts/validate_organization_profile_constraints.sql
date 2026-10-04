-- Run after the organization importer has applied every referenced source row.
-- This single statement checks old references before validating both foreign keys.
do $$
begin
  if exists (
    select 1
    from public.profiles as profile
    left join public.departments as department
      on department.id = profile.department_id
    where profile.department_id is not null
      and department.id is null
  ) or exists (
    select 1
    from public.profiles as profile
    left join public.posts as post on post.id = profile.post_id
    where profile.post_id is not null
      and post.id is null
  ) then
    raise exception 'Cannot validate organization foreign keys: a profile reference is unresolved';
  end if;

  alter table public.profiles
    validate constraint profiles_department_id_fkey;
  alter table public.profiles
    validate constraint profiles_post_id_fkey;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.profiles'::regclass
      and constraint_row.conname in (
        'profiles_department_id_fkey',
        'profiles_post_id_fkey'
      )
      and not constraint_row.convalidated
  ) then
    raise exception 'Organization foreign-key validation did not complete';
  end if;
end;
$$;

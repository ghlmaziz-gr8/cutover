-- Platform roles: a person can hold several of super_user, admin, sales and support. They apply across Cutover,
-- not to one workspace. Run after add-staff.sql. Safe to run twice.
alter table public.staff add column if not exists roles text[] not null default '{}';

-- Keep the single role from add-staff.sql: owner becomes admin.
update public.staff
   set roles = array[case when role = 'owner' then 'admin' else role end]
 where roles = '{}' and role is not null;

alter table public.staff drop column if exists role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_roles_valid') then
    alter table public.staff add constraint staff_roles_valid
      check (cardinality(roles) > 0 and roles <@ array['super_user', 'admin', 'sales', 'support']::text[]);
  end if;
end $$;

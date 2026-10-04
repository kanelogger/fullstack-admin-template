-- Preserve both menu administration reads and caller-filtered navigation while
-- evaluating them through one permissive SELECT policy.
drop policy menus_read_navigation on public.menus;

alter policy menus_read_authorized on public.menus
using (
  (select app_private.has_permission('administration.menus.read'))
  or (select app_private.can_read_menu(id))
);

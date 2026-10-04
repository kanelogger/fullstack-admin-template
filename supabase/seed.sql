insert into public.roles (code, name, description, is_system)
values
  ('SUPER_ADMIN', '超级管理员', '拥有全部管理权限', true),
  ('OPERATOR', '运营人员', '可读取已授权模块，写入操作由权限键控制', true),
  ('COMMON_USER', '普通用户', '仅访问本人资料和消息', true)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_system = excluded.is_system,
    is_active = true,
    updated_at = now();

insert into public.permission_catalog (permission_key, description)
values
  ('dashboard.overview.read', '读取仪表盘概览'),
  ('identity.profile.read', '读取当前用户资料'),
  ('identity.profile.update', '更新当前用户资料'),
  ('communication.messages.read', '读取授权范围内的消息'),
  ('communication.messages.create', '创建消息'),
  ('communication.messages.update', '更新授权范围内的消息'),
  ('communication.messages.delete', '删除授权范围内的消息'),
  ('administration.users.read', '读取用户管理数据'),
  ('administration.users.create', '创建用户'),
  ('administration.users.update', '更新用户'),
  ('administration.users.delete', '停用或删除用户'),
  ('administration.users.assign_roles', '分配用户角色'),
  ('administration.users.reset_password', '为用户发送密码重置邮件'),
  ('administration.roles.read', '读取角色和角色权限'),
  ('administration.roles.create', '创建角色'),
  ('administration.roles.update', '更新角色'),
  ('administration.roles.delete', '删除角色'),
  ('administration.roles.assign_permissions', '分配角色权限'),
  ('administration.menus.read', '读取菜单'),
  ('administration.menus.create', '创建菜单'),
  ('administration.menus.update', '更新菜单'),
  ('administration.menus.delete', '删除菜单'),
  ('organization.departments.read', '读取组织部门'),
  ('organization.departments.create', '创建组织部门'),
  ('organization.departments.update', '更新组织部门'),
  ('organization.departments.delete', '删除组织部门'),
  ('organization.posts.read', '读取岗位'),
  ('organization.posts.create', '创建岗位'),
  ('organization.posts.update', '更新岗位'),
  ('organization.posts.delete', '删除岗位'),
  ('configuration.dictionaries.read', '读取数据字典'),
  ('configuration.dictionaries.create', '创建数据字典'),
  ('configuration.dictionaries.update', '更新数据字典'),
  ('configuration.dictionaries.delete', '删除数据字典'),
  ('configuration.system.read', '读取系统配置'),
  ('configuration.system.update', '更新系统配置'),
  ('files.attachments.read', '读取授权范围内的附件'),
  ('files.attachments.upload', '上传附件'),
  ('files.attachments.delete', '删除授权范围内的附件'),
  ('audit.logs.read', '读取审计日志')
on conflict (permission_key) do update
set description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select role.id, permission.permission_key
from public.roles as role
cross join public.permission_catalog as permission
where role.code = 'OPERATOR'
  and permission.permission_key in (
    'dashboard.overview.read',
    'identity.profile.read',
    'identity.profile.update',
    'communication.messages.read',
    'files.attachments.read'
  )
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select role.id, permission.permission_key
from public.roles as role
cross join public.permission_catalog as permission
where role.code = 'COMMON_USER'
  and permission.permission_key in (
    'identity.profile.read',
    'identity.profile.update',
    'communication.messages.read'
  )
on conflict do nothing;

delete from public.role_permissions as role_permission
using public.roles as role
where role.id = role_permission.role_id
  and role.code = 'COMMON_USER'
  and role_permission.permission_key = 'dashboard.overview.read';

insert into public.menus (
  id, parent_id, kind, route_key, path, title, icon, sort_order,
  is_visible, is_active, required_permission_key
)
values
  (1, null, 'route', 'dashboard.overview', '/welcome', '首页', 'HomeFilled', 0, true, true, 'dashboard.overview.read'),
  (2, null, 'group', null, '/system', '系统管理', 'SetUp', 10, true, true, null),
  (3, 2, 'route', 'administration.users', '/system/users', '用户管理', 'UserFilled', 0, true, true, 'administration.users.read'),
  (4, 2, 'route', 'administration.roles', '/system/roles', '角色管理', 'UserFilled', 1, true, true, 'administration.roles.read'),
  (5, 2, 'route', 'administration.menus', '/system/menus', '菜单管理', 'Menu', 2, true, true, 'administration.menus.read'),
  (6, 2, 'route', 'administration.departments', '/system/departments', '部门管理', 'OfficeBuilding', 3, true, true, 'organization.departments.read'),
  (7, 2, 'route', 'administration.posts', '/system/posts', '岗位管理', 'Postcard', 4, true, true, 'organization.posts.read'),
  (8, 2, 'route', 'administration.configurations', '/system/configs', '系统配置', 'Tools', 5, true, true, 'configuration.system.read'),
  (9, 2, 'route', 'administration.dictionaries', '/system/dicts', '数据字典', 'Collection', 6, true, true, 'configuration.dictionaries.read'),
  (10, null, 'group', null, '/operation', '运营管理', 'Operation', 20, true, true, null),
  (11, 10, 'route', 'communication.messages', '/operation/messages', '消息中心', 'Message', 0, true, true, 'communication.messages.read'),
  (12, 10, 'route', 'operation.attachments', '/operation/attachments', '附件管理', 'Paperclip', 1, true, true, 'files.attachments.read'),
  (13, null, 'group', null, '/log', '日志审计', 'Document', 30, true, true, null),
  (14, 13, 'route', 'audit.login-logs', '/log/login-logs', '登录日志', 'Key', 0, true, true, 'audit.logs.read'),
  (15, 13, 'route', 'audit.operation-logs', '/log/operation-logs', '操作日志', 'Pointer', 1, true, true, 'audit.logs.read'),
  (16, 13, 'route', 'audit.exception-logs', '/log/exception-logs', '异常日志', 'WarningFilled', 2, true, true, 'audit.logs.read'),
  (17, null, 'group', null, '/profile', '个人中心', 'User', 40, true, true, null),
  (18, 17, 'route', 'account.profile', '/profile/info', '个人信息', 'UserFilled', 0, true, true, 'identity.profile.read'),
  (19, 17, 'route', 'account.change-password', '/profile/change-password', '修改密码', 'Lock', 1, true, true, 'identity.profile.read')
on conflict (id) do update
set parent_id = excluded.parent_id,
    kind = excluded.kind,
    route_key = excluded.route_key,
    path = excluded.path,
    title = excluded.title,
    icon = excluded.icon,
    sort_order = excluded.sort_order,
    is_visible = excluded.is_visible,
    is_active = excluded.is_active,
    required_permission_key = excluded.required_permission_key,
    updated_at = now();

select setval(
  pg_get_serial_sequence('public.menus', 'id'),
  coalesce((select max(id) from public.menus), 1),
  exists(select 1 from public.menus)
);

delete from public.role_permissions as role_permission
using public.roles as role
where role.id = role_permission.role_id
  and role.code = 'COMMON_USER'
  and role_permission.permission_key = 'dashboard.overview.read';

insert into public.menus (
  id, parent_id, kind, route_key, path, title, icon, sort_order,
  is_visible, is_active, required_permission_key
)
values
  (1, null, 'route', 'dashboard.overview', '/welcome', '首页', 'HomeFilled', 0, true, true, 'dashboard.overview.read'),
  (2, null, 'group', null, '/system', '系统管理', 'SetUp', 10, true, true, null),
  (3, 2, 'route', 'administration.users', '/system/users', '用户管理', 'UserFilled', 0, true, true, 'administration.users.read'),
  (4, 2, 'route', 'administration.roles', '/system/roles', '角色管理', 'UserFilled', 1, true, true, 'administration.roles.read'),
  (5, 2, 'route', 'administration.menus', '/system/menus', '菜单管理', 'Menu', 2, true, true, 'administration.menus.read'),
  (6, 2, 'route', 'administration.departments', '/system/departments', '部门管理', 'OfficeBuilding', 3, true, true, 'organization.departments.read'),
  (7, 2, 'route', 'administration.posts', '/system/posts', '岗位管理', 'Postcard', 4, true, true, 'organization.posts.read'),
  (8, 2, 'route', 'administration.configurations', '/system/configs', '系统配置', 'Tools', 5, true, true, 'configuration.system.read'),
  (9, 2, 'route', 'administration.dictionaries', '/system/dicts', '数据字典', 'Collection', 6, true, true, 'configuration.dictionaries.read'),
  (10, null, 'group', null, '/operation', '运营管理', 'Operation', 20, true, true, null),
  (11, 10, 'route', 'communication.messages', '/operation/messages', '消息中心', 'Message', 0, true, true, 'communication.messages.read'),
  (12, 10, 'route', 'operation.attachments', '/operation/attachments', '附件管理', 'Paperclip', 1, true, true, 'files.attachments.read'),
  (13, null, 'group', null, '/log', '日志审计', 'Document', 30, true, true, null),
  (14, 13, 'route', 'audit.login-logs', '/log/login-logs', '登录日志', 'Key', 0, true, true, 'audit.logs.read'),
  (15, 13, 'route', 'audit.operation-logs', '/log/operation-logs', '操作日志', 'Pointer', 1, true, true, 'audit.logs.read'),
  (16, 13, 'route', 'audit.exception-logs', '/log/exception-logs', '异常日志', 'WarningFilled', 2, true, true, 'audit.logs.read'),
  (17, null, 'group', null, '/profile', '个人中心', 'User', 40, true, true, null),
  (18, 17, 'route', 'account.profile', '/profile/info', '个人信息', 'UserFilled', 0, true, true, 'identity.profile.read'),
  (19, 17, 'route', 'account.change-password', '/profile/change-password', '修改密码', 'Lock', 1, true, true, 'identity.profile.read')
on conflict (id) do update
set parent_id = excluded.parent_id,
    kind = excluded.kind,
    route_key = excluded.route_key,
    path = excluded.path,
    title = excluded.title,
    icon = excluded.icon,
    sort_order = excluded.sort_order,
    is_visible = excluded.is_visible,
    is_active = excluded.is_active,
    required_permission_key = excluded.required_permission_key,
    updated_at = now();

select setval(
  pg_get_serial_sequence('public.menus', 'id'),
  coalesce((select max(id) from public.menus), 1),
  exists(select 1 from public.menus)
);

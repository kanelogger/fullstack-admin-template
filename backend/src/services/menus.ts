import { pool } from "../db/mysql";
import { buildTree, type TreeNode } from "../utils/tree";

export interface MenuRow {
  id: number;
  menu_code: string;
  menu_name: string;
  parent_id: number | null;
  icon: string | null;
  sort_order: number;
  route_path: string;
  component_path: string | null;
  visible: number;
  status: number;
  meta_json: string | null;
}

export interface MenuRoute {
  id: number;
  parentId: number | null;
  name: string;
  path: string;
  component?: string;
  redirect?: string;
  meta: {
    title: string;
    icon?: string;
    sort?: number;
    showLink?: boolean;
    [key: string]: unknown;
  };
  children?: MenuRoute[];
}

export interface MenuMeta {
  title: string;
  icon?: string;
  sort?: number;
  showLink?: boolean;
  [key: string]: unknown;
}

function parseMeta(metaJson: string | null): Record<string, unknown> {
  if (!metaJson) return {};
  try {
    return JSON.parse(metaJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 判断用户是否拥有超级管理员角色
 */
export async function isSuperAdmin(userId: number): Promise<boolean> {
  const [rows] = await pool.execute(
    `SELECT 1
     FROM roles r
     INNER JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ? AND ur.deleted = 0 AND r.deleted = 0
       AND r.status = 1 AND r.is_super_admin = 1
     LIMIT 1`,
    [userId]
  );
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * 查询全部启用菜单（超级管理员用）
 */
export async function getAllEnabledMenus(): Promise<MenuRow[]> {
  const [rows] = await pool.execute(
    `SELECT * FROM menus
     WHERE status = 1 AND deleted = 0
     ORDER BY parent_id ASC, sort_order ASC, id ASC`
  );
  return rows as MenuRow[];
}

/**
 * 查询用户可访问的启用菜单（已启用角色授权）
 */
export async function getMenusByUserId(userId: number): Promise<MenuRow[]> {
  const [rows] = await pool.execute(
    `SELECT DISTINCT m.*
     FROM menus m
     INNER JOIN role_menus rm ON rm.menu_id = m.id
     INNER JOIN roles r ON r.id = rm.role_id
     INNER JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?
       AND ur.deleted = 0
       AND rm.deleted = 0
       AND r.deleted = 0 AND r.status = 1
       AND m.deleted = 0 AND m.status = 1
     ORDER BY m.parent_id ASC, m.sort_order ASC, m.id ASC`,
    [userId]
  );
  return rows as MenuRow[];
}

/**
 * 根据用户 ID 获取菜单路由树
 */
export async function getMenuRoutesByUserId(
  userId: number
): Promise<MenuRoute[]> {
  const superAdmin = await isSuperAdmin(userId);
  const rows = superAdmin
    ? await getAllEnabledMenus()
    : await getMenusByUserId(userId);

  return buildMenuTree(rows);
}

/**
 * 将扁平菜单行构建为树形 MenuRoute[]
 */
export function buildMenuTree(rows: MenuRow[]): MenuRoute[] {
  const routes = rows.map((row) => {
    const meta = parseMeta(row.meta_json);
    const route: MenuRoute = {
      id: row.id,
      parentId: row.parent_id,
      name: row.menu_code,
      path: row.route_path,
      meta: {
        title: (meta.title as string) || row.menu_name,
        icon: row.icon ?? undefined,
        sort: row.sort_order,
        showLink: row.visible === 1,
        ...meta,
      },
    };

    if (row.component_path) {
      route.component = row.component_path;
    }

    return route;
  });

  const roots = buildTree(routes as Array<MenuRoute & TreeNode>);
  sortMenuRoutes(roots);

  return roots;
}

function sortMenuRoutes(routes: MenuRoute[]): void {
  routes.sort((a, b) => (a.meta.sort ?? 0) - (b.meta.sort ?? 0));
  for (const route of routes) {
    if (route.children && route.children.length > 0) {
      sortMenuRoutes(route.children);
    }
  }
}

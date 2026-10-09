import { RouterView, type RouteRecordRaw } from "vue-router";
import type { MenuEntry } from "@template/contracts/menu";
import { resolveMenuRouteComponent } from "./menu-routes.registry";

type NavigationNode = MenuEntry & { children: NavigationNode[] };
type DynamicRoute = RouteRecordRaw & {
  id: string;
  parentId: string | null;
};

/** Build routes only from RouteKeys registered in the frontend bundle. */
export function buildNavigationRoutes(entries: MenuEntry[]): DynamicRoute[] {
  const nodes = new Map<string, NavigationNode>();
  for (const entry of entries) {
    if (nodes.has(entry.id)) throw new Error("Supabase navigation contains duplicate IDs");
    nodes.set(entry.id, { ...entry, children: [] });
  }

  const roots: NavigationNode[] = [];
  for (const node of nodes.values()) {
    if (!node.parentId) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(node.parentId);
    if (!parent || parent.kind !== "group") {
      throw new Error("Supabase navigation has a missing or non-group parent");
    }
    parent.children.push(node);
  }

  const sortTree = (siblings: NavigationNode[]) => {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    siblings.forEach((node) => sortTree(node.children));
  };
  sortTree(roots);

  const visited = new Set<string>();
  const mapNode = (node: NavigationNode): DynamicRoute | null => {
    if (visited.has(node.id)) throw new Error("Supabase navigation contains a cycle");
    visited.add(node.id);
    const children = node.children
      .map(mapNode)
      .filter((route): route is DynamicRoute => route !== null);

    if (node.kind === "group") {
      if (children.length === 0) return null;
      return {
        id: node.id,
        parentId: node.parentId,
        name: `menu-group-${node.id}`,
        path: node.path,
        component: RouterView,
        redirect: children[0].path,
        meta: {
          title: node.title,
          icon: node.icon ?? undefined,
          rank: node.sortOrder,
          showLink: true,
          auths: [],
          backstage: true
        },
        children
      };
    }

    if (children.length > 0 || !node.routeKey) {
      throw new Error("Supabase route menu has an invalid hierarchy");
    }
    const component = resolveMenuRouteComponent(node.routeKey);
    if (!component) throw new Error("Supabase route key is not registered by the frontend");

    return {
      id: node.id,
      parentId: node.parentId,
      name: node.routeKey,
      path: node.path,
      component,
      meta: {
        title: node.title,
        icon: node.icon ?? undefined,
        rank: node.sortOrder,
        showLink: true,
        auths: node.requiredPermissionKey ? [node.requiredPermissionKey] : [],
        backstage: true
      }
    };
  };

  const routes = roots.map(mapNode).filter((route): route is DynamicRoute => route !== null);
  if (visited.size !== nodes.size) throw new Error("Supabase navigation contains unreachable rows");
  return routes;
}

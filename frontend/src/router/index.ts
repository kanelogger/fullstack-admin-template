import { getConfig } from "@/config";
import NProgress from "@/utils/progress";
import { buildHierarchyTree } from "@/utils/tree";
import remainingRouter from "./modules/remaining";
import { useTabsStoreHook } from "@/stores/modules/tabs";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import { useSessionStoreHook } from "@/stores/modules/session";
import { findRegisteredMenuRouteByPath } from "@/features/menus/menu-routes.registry";
import { openLink, cloneDeep } from "@/utils/shared";
import {
  ascending,
  getTopMenu,
  initRouter,
  isOneOfArray,
  getHistoryMode,
  findRouteByPath,
  handleAliveRoute,
  formatTwoStageRoutes,
  formatFlatteningRoutes
} from "./utils";
import {
  type RouteRecordRaw,
  type RouteComponent,
  type Router,
  createRouter
} from "vue-router";

/** 自动导入全部静态路由，无需再手动引入！匹配 src/router/modules 目录（任何嵌套级别）中具有 .ts 扩展名的所有文件，除了 remaining.ts 文件
 * 如何匹配所有文件请看：https://github.com/mrmlnc/fast-glob#basic-syntax
 * 如何排除文件请看：https://cn.vitejs.dev/guide/features.html#negative-patterns
 */
const modules: Record<string, any> = import.meta.glob(
  ["./modules/**/*.ts", "!./modules/**/remaining.ts"],
  {
    eager: true
  }
);

/** 原始静态路由（未做任何处理） */
const routes = [];

Object.keys(modules).forEach(key => {
  routes.push(modules[key].default);
});

/** 导出处理后的静态路由（三级及以上的路由全部拍成二级） */
export const constantRoutes: Array<RouteRecordRaw> = formatTwoStageRoutes(
  formatFlatteningRoutes(buildHierarchyTree(ascending(routes.flat(Infinity))))
);

/** 初始的静态路由，用于退出登录时重置路由 */
const initConstantRoutes: Array<RouteRecordRaw> = cloneDeep(constantRoutes);

/** 用于渲染菜单，保持原始层级 */
export const constantMenus: Array<RouteComponent> = ascending(
  routes.flat(Infinity)
).concat(...remainingRouter);

/** 不参与菜单的路由 */
export const remainingPaths = Object.keys(remainingRouter).map(v => {
  return remainingRouter[v].path;
});

/** 创建路由实例 */
export const router: Router = createRouter({
  history: getHistoryMode(import.meta.env.VITE_ROUTER_HISTORY),
  routes: constantRoutes.concat(...(remainingRouter as any)),
  strict: true,
  scrollBehavior(to, from, savedPosition) {
    return new Promise(resolve => {
      if (savedPosition) {
        return savedPosition;
      } else {
        if (from.meta.saveSrollTop) {
          const top: number =
            document.documentElement.scrollTop || document.body.scrollTop;
          resolve({ left: 0, top });
        }
      }
    });
  }
});

/** 记录已经加载的页面路径 */
const loadedPaths = new Set<string>();

/** 重置已加载页面记录 */
export function resetLoadedPaths() {
  loadedPaths.clear();
}

/** 重置路由 */
export function resetRouter() {
  router.clearRoutes();
  for (const route of initConstantRoutes.concat(...(remainingRouter as any))) {
    router.addRoute(route);
  }
  router.options.routes = formatTwoStageRoutes(
    formatFlatteningRoutes(buildHierarchyTree(ascending(routes.flat(Infinity))))
  );
  usePermissionStoreHook().clearAllCachePage();
  resetLoadedPaths();
}

/** Public error routes stay available without an application session. */
const whiteList = ["/login"];
const publicErrorPaths = new Set(["/access-denied", "/server-error"]);

function externalLinkName(name: unknown): name is string {
  return typeof name === "string" && /^https?:\/\//i.test(name);
}

router.beforeEach(async (to: ToRouteType, from) => {
  to.meta.loaded = loadedPaths.has(to.path);
  if (!to.meta.loaded) NProgress.start();

  if (to.meta?.keepAlive) {
    handleAliveRoute(to, "add");
    if (from.name === undefined || from.name === "Redirect") handleAliveRoute(to);
  }

  if (!externalLinkName(to.name)) {
    to.matched.some(item => {
      if (!item.meta.title) return "";
      const title = getConfig().Title;
      document.title = title ? `${item.meta.title} | ${title}` : item.meta.title as string;
    });
  }

  if (
    to.path === "/reset-password" ||
    publicErrorPaths.has(to.path)
  ) return true;

  const unknownPath = to.name === "PageNotFound" &&
    !findRegisteredMenuRouteByPath(to.path);

  let hasSession = false;
  try {
    hasSession = await useSessionStoreHook().restoreSession();
  } catch {
    useSessionStoreHook().clearLocalSession(false);
  }
  if (!hasSession) {
    if (whiteList.includes(to.path)) return true;
    // Unknown URLs stay public 404s when signed out. A private custom RouteKey
    // path is only resolved after an authenticated navigation read.
    if (unknownPath) return true;
    return { path: "/login" };
  }

  const permissionStore = usePermissionStoreHook();

  if (unknownPath) {
    try {
      await initRouter();
    } catch {
      return { path: "/server-error" };
    }
    const resolved = router.resolve(to.fullPath);
    if (!resolved.matched.some(record => record.meta.backstage)) return true;
    // Re-enter the guard with the resolved server-filtered route metadata.
    return to.fullPath;
  }

  if (externalLinkName(to.name)) {
    openLink(to.name as string);
    return false;
  }
  if (to.meta?.roles && !isOneOfArray(to.meta.roles, permissionStore.roleCodes)) {
    return { path: "/access-denied" };
  }
  const defaultMenu = findRegisteredMenuRouteByPath(to.path);
  const requiredPermissions = to.meta?.auths?.length
    ? to.meta.auths
    : defaultMenu
      ? [defaultMenu.requiredPermissionKey]
      : [];
  if (!requiredPermissions.every(permission => permissionStore.permissionKeys.includes(permission))) {
    return { path: "/access-denied" };
  }

  if (to.path === "/login" || (from.name === undefined && permissionStore.wholeMenus.length === 0)) {
    try {
      await initRouter();
    } catch {
      useSessionStoreHook().logOut();
      return { path: "/login" };
    }

    const landingMenu = getTopMenu(true);
    if (!permissionStore.wholeMenus.length || !landingMenu?.path) {
      return { path: "/access-denied" };
    }
    if (to.path === "/login") return landingMenu.path;

    const homeRoute = router.options.routes.find(route => route.name === "Home");
    const currentMenu = homeRoute?.children
      ? findRouteByPath(to.path, homeRoute.children)
      : null;
    if (currentMenu?.meta?.title) {
      const tagMenu = currentMenu.children?.length ? currentMenu.children[0] : currentMenu;
      useTabsStoreHook().handleTags("push", {
        path: tagMenu.path,
        name: tagMenu.name,
        meta: tagMenu.meta
      });
    }
    // Re-resolve a deep link after the caller-filtered routes are installed.
    return to.fullPath;
  }

  return true;
});

router.afterEach(to => {
  loadedPaths.add(to.path);
  NProgress.done();
});

export default router;

import type { RouteRecordRaw } from "vue-router";

const Layout = () => import("@/layouts/index.vue");

const remainingRoutes: RouteRecordRaw[] = [
  {
    path: "/reset-password",
    name: "ResetPassword",
    component: () => import("@/features/auth/pages/reset-password.vue"),
    meta: {
      title: "重置密码",
      showLink: false
    }
  },
  {
    path: "/login",
    name: "Login",
    component: () => import("@/features/auth/pages/login.vue"),
    meta: {
      title: "登录",
      showLink: false
    }
  },
  // 全屏403（无权访问）页面
  {
    path: "/access-denied",
    name: "AccessDenied",
    component: () => import("@/features/errors/pages/403.vue"),
    meta: {
      title: "403",
      showLink: false
    }
  },
  // 全屏500（服务器出错）页面
  {
    path: "/server-error",
    name: "ServerError",
    component: () => import("@/features/errors/pages/500.vue"),
    meta: {
      title: "500",
      showLink: false
    }
  },
  {
    path: "/:pathMatch(.*)*",
    name: "PageNotFound",
    component: () => import("@/features/errors/pages/404.vue"),
    meta: {
      title: "404",
      showLink: false
    }
  },
  {
    path: "/redirect",
    component: Layout,
    meta: {
      title: "加载中...",
      showLink: false
    },
    children: [
      {
        path: "/redirect/:path(.*)",
        name: "Redirect",
        component: () => import("@/layouts/redirect.vue")
      }
    ]
  }
];

export default remainingRoutes;

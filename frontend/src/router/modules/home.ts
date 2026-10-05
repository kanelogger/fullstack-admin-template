const Layout = () => import("@/layouts/index.vue");

export default {
  path: "/",
  name: "Home",
  component: Layout,
  meta: {
    title: "工作台",
    showLink: false
  }
} satisfies RouteConfigsTable;

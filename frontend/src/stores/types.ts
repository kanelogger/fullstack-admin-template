import type { LocationQueryRaw, RouteParamsRaw, RouteRecordName, RouteMeta } from "vue-router";

export type cacheType = {
  mode: string;
  name?: RouteRecordName;
};

export type positionType = {
  startIndex?: number;
  length?: number;
};

export type uiType = {
  sidebar: {
    opened: boolean;
    withoutAnimation: boolean;
    // 判断是否手动点击Collapse
    isClickCollapse: boolean;
  };
  layout: string;
  device: string;
  viewportSize: { width: number; height: number };
};

export type tabType = {
  path: string;
  name: string;
  meta: RouteMeta;
  query?: LocationQueryRaw;
  params?: RouteParamsRaw;
};

export type sessionType = {
  avatar?: string;
  username?: string;
  nickname?: string;
  userId?: string;
  authUserId?: string;
  authSessionId?: string;
  isAuthenticated?: boolean;
  authReady?: boolean;
  mustResetPassword?: boolean;
};

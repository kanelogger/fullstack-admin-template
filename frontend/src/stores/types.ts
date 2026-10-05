import type { RouteRecordName } from "vue-router";

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
  meta: any;
  query?: object;
  params?: object;
};

export type sessionType = {
  avatar?: string;
  username?: string;
  nickname?: string;
  userId?: string;
  authUserId?: string;
  isAuthenticated?: boolean;
  authReady?: boolean;
  mustResetPassword?: boolean;
};

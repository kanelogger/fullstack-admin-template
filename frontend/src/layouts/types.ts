import type { FunctionalComponent } from "vue";
import type { LocationQueryRaw, RouteParamsRaw, RouteRecordName } from "vue-router";

/** Supabase navigation is session-scoped; no legacy route tags survive logout. */
export const routerArrays: Array<RouteConfigs> = [];

export type routeMetaType = {
  title?: string;
  icon?: string | FunctionalComponent;
  showLink?: boolean;
  savedPosition?: boolean;
  auths?: Array<string>;
  fixedTag?: boolean;
  rank?: number;
  frameSrc?: string;
  frameLoading?: boolean;
  keepAlive?: boolean;
  showParent?: boolean;
  hiddenTag?: boolean;
  dynamicLevel?: number;
  activePath?: string;
  backstage?: boolean;
  extraIcon?: string | FunctionalComponent;
};

export type RouteConfigs = {
  path?: string;
  query?: LocationQueryRaw;
  params?: RouteParamsRaw;
  meta?: routeMetaType;
  children?: RouteConfigs[];
  name?: RouteRecordName;
  redirect?: string;
  id?: number;
  parentId?: number | null;
  pathList?: Array<number | string>;
  value?: unknown;
};

export type multiTagsType = {
  tags: Array<RouteConfigs>;
};

export type tagsViewsType = {
  icon: string | FunctionalComponent;
  text: string;
  divided: boolean;
  disabled: boolean;
  show: boolean;
};

export type menuType = RouteConfigs & {
  noShowingChildren?: boolean;
  showTooltip?: boolean;
};

export interface scrollbarDomType extends HTMLElement {
  wrap?: {
    offsetWidth: number;
  };
}

import Axios, {
  type InternalAxiosRequestConfig,
  type AxiosInstance,
  type AxiosRequestConfig,
  type CustomParamsSerializer
} from "axios";
import type {
  PureHttpError,
  RequestMethods,
  PureHttpResponse,
  PureHttpRequestConfig
} from "./types.d";
import { stringify } from "qs";
import {
  getAuthSessionRevision,
  getToken,
  formatToken
} from "@/utils/auth";
import type { RefreshTokenData } from "@/api/user";
import { useUserStoreHook } from "@/store/modules/user";

// 相关配置请参考：www.axios-js.com/zh-cn/docs/#axios-request-config-1
const defaultConfig: AxiosRequestConfig = {
  // 接口基础路径，生产环境可配置为统一网关地址
  baseURL: (import.meta.env.VITE_API_BASE_URL as string) || "",
  // 请求超时时间
  timeout: 10000,
  headers: {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest"
  },
  // 数组格式参数序列化（https://github.com/axios/axios/issues/5142）
  paramsSerializer: {
    serialize: stringify as unknown as CustomParamsSerializer
  }
};

type TokenRefreshFlight = {
  sessionRevision: number;
  refreshToken: string;
  promise: Promise<RefreshTokenData>;
};

function sessionChangedError() {
  const error = new Error("Session changed during token refresh");
  Object.assign(error, { code: "SESSION_CHANGED" });
  return error;
}

class PureHttp {
  constructor() {
    this.httpInterceptorsRequest();
    this.httpInterceptorsResponse();
  }

  /** 并发请求共享同一 Session 的刷新；新 Session 不等待旧刷新结果。 */
  private static refreshFlight: TokenRefreshFlight | null = null;

  /** 初始化配置对象 */
  private static initConfig: PureHttpRequestConfig = {};

  /** 保存当前`Axios`实例对象 */
  private static axiosInstance: AxiosInstance = Axios.create(defaultConfig);

  /** 请求拦截 */
  private httpInterceptorsRequest(): void {
    PureHttp.axiosInstance.interceptors.request.use(
      async (
        config: PureHttpRequestConfig
      ): Promise<InternalAxiosRequestConfig> => {
        const requestConfig =
          config as unknown as InternalAxiosRequestConfig;
        // 优先判断post/get等方法是否传入回调，否则执行初始化设置等回调
        if (typeof config.beforeRequestCallback === "function") {
          config.beforeRequestCallback(config);
          return requestConfig;
        }
        if (PureHttp.initConfig.beforeRequestCallback) {
          PureHttp.initConfig.beforeRequestCallback(config);
          return requestConfig;
        }
        /** 请求白名单，放置一些不需要`token`的接口（通过设置请求白名单，防止`token`过期后再请求造成的死循环问题） */
        const whiteList = ["/refresh-token", "/login"];
        if (whiteList.some(url => config.url.endsWith(url))) return requestConfig;

        const data = getToken();
        if (!data) return requestConfig;

        const expired = Number(data.expires) - Date.now() <= 0;
        if (!expired) {
          requestConfig.headers["Authorization"] = formatToken(data.accessToken);
          return requestConfig;
        }

        const sessionRevision = getAuthSessionRevision();
        let flight = PureHttp.refreshFlight;
        if (
          !flight ||
          flight.sessionRevision !== sessionRevision ||
          flight.refreshToken !== data.refreshToken
        ) {
          let newFlight: TokenRefreshFlight | null = null;
          const promise = useUserStoreHook()
            .handRefreshToken(
              { refreshToken: data.refreshToken },
              sessionRevision
            )
            .catch(error => {
              const status = error?.response?.status;
              const code = error?.response?.data?.error?.code ?? error?.code;
              const sessionIsCurrent =
                getAuthSessionRevision() === sessionRevision &&
                getToken()?.refreshToken === data.refreshToken;
              const authenticationFailure =
                status === 401 ||
                status === 403 ||
                code === "UNAUTHORIZED" ||
                code === "INVALID_REFRESH_TOKEN" ||
                code === "INVALID_REFRESH_RESPONSE";
              if (sessionIsCurrent && authenticationFailure) {
                useUserStoreHook().logOut();
              }
              throw error;
            })
            .finally(() => {
              if (newFlight && PureHttp.refreshFlight === newFlight) {
                PureHttp.refreshFlight = null;
              }
            });
          newFlight = {
            sessionRevision,
            refreshToken: data.refreshToken,
            promise
          };
          PureHttp.refreshFlight = newFlight;
          flight = newFlight;
        }

        const refreshed = await flight.promise;
        if (
          getAuthSessionRevision() !== sessionRevision ||
          getToken()?.refreshToken !== refreshed.refreshToken
        ) {
          throw sessionChangedError();
        }

        requestConfig.headers["Authorization"] = formatToken(
          refreshed.accessToken
        );
        return requestConfig;
      },
      error => {
        return Promise.reject(error);
      }
    );
  }

  /** 响应拦截 */
  private httpInterceptorsResponse(): void {
    const instance = PureHttp.axiosInstance;
    instance.interceptors.response.use(
      (response: PureHttpResponse) => {
        const $config = response.config;
        // 优先判断post/get等方法是否传入回调，否则执行初始化设置等回调
        if (typeof $config.beforeResponseCallback === "function") {
          $config.beforeResponseCallback(response);
          return response.data;
        }
        if (PureHttp.initConfig.beforeResponseCallback) {
          PureHttp.initConfig.beforeResponseCallback(response);
          return response.data;
        }
        return response.data;
      },
      (error: PureHttpError) => {
        const $error = error;
        $error.isCancelRequest = Axios.isCancel($error);
        // 所有的响应异常 区分来源为取消请求/非取消请求
        return Promise.reject($error);
      }
    );
  }

  /** 通用请求工具函数 */
  public request<T>(
    method: RequestMethods,
    url: string,
    param?: AxiosRequestConfig,
    axiosConfig?: PureHttpRequestConfig
  ): Promise<T> {
    const config = {
      method,
      url,
      ...param,
      ...axiosConfig
    } as PureHttpRequestConfig;

    // 单独处理自定义请求/响应回调
    return new Promise((resolve, reject) => {
      PureHttp.axiosInstance
        .request(config)
        .then((response: undefined) => {
          resolve(response);
        })
        .catch(error => {
          reject(error);
        });
    });
  }

  /** 单独抽离的`post`工具函数 */
  public post<T, P>(
    url: string,
    params?: AxiosRequestConfig<P>,
    config?: PureHttpRequestConfig
  ): Promise<T> {
    return this.request<T>("post", url, params, config);
  }

  /** 单独抽离的`get`工具函数 */
  public get<T, P>(
    url: string,
    params?: AxiosRequestConfig<P>,
    config?: PureHttpRequestConfig
  ): Promise<T> {
    return this.request<T>("get", url, params, config);
  }
}

export const http = new PureHttp();

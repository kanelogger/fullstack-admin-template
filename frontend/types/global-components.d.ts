declare module "vue" {
  export interface GlobalComponents {
    IconifyIconOffline: (typeof import("../src/components/ReIcon"))["IconifyIconOffline"];
    IconifyIconOnline: (typeof import("../src/components/ReIcon"))["IconifyIconOnline"];
    FontIcon: (typeof import("../src/components/ReIcon"))["FontIcon"];
  }
}

export {};

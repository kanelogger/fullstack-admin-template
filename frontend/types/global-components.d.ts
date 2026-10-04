declare module "vue" {
  export interface GlobalComponents {
    IconifyIconOffline: (typeof import("../src/components/ReIcon"))["IconifyIconOffline"];
    IconifyIconOnline: (typeof import("../src/components/ReIcon"))["IconifyIconOnline"];
    FontIcon: (typeof import("../src/components/ReIcon"))["FontIcon"];
    Auth: (typeof import("../src/components/ReAuth"))["Auth"];
    Perms: (typeof import("../src/components/RePerms"))["Perms"];
  }
}

export {};

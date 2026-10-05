import type { App } from "vue";
import { createPinia } from "pinia";
import { storageLocal } from "@/utils/shared";
const store = createPinia();

export function setupStore(app: App<Element>) {
  storageLocal().removeItem("user-info");
  app.use(store);
}

export { store };

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": resolve(frontendRoot, "src") }
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.component.test.ts"],
    restoreMocks: true,
    clearMocks: true
  }
});

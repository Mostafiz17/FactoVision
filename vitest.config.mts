import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
  },
});

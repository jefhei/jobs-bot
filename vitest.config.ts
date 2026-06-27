import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@jobpulse/shared": path.resolve(__dirname, "./shared/src"),
    },
  },
});

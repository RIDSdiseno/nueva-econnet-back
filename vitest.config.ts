import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global.ts"],
    setupFiles: ["tests/preparar.ts"],
    /* Las pruebas comparten una base de datos: en serie, sin sorpresas. */
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000
  }
});

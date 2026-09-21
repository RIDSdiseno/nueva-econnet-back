// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src/generated/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["error"] }],
      eqeqeq: ["error", "smart"]
    }
  },
  {
    files: ["tests/**/*.ts", "prisma/seed.ts", "src/scripts/**/*.ts"],
    rules: { "no-console": "off" }
  }
,
  {
    /* Las herramientas de terminal hablan por consola: es su salida. */
    files: ["src/herramientas/**/*.ts"],
    rules: { "no-console": "off" }
  }
);

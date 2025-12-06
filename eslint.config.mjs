import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig({
  ignores: [
    "src/backend/public/js/**",
    "**/node_modules/**",
    ".git/**",
    "**/.DS_Store",
  ],
  overrides: [
    { files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], plugins: { js }, extends: ["js/recommended"], languageOptions: { globals: globals.browser } },
    { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
    tseslint.configs.recommended,
  ],
});

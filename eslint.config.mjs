import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "src/backend/public/js/**",
      "**/node_modules/**",
      ".git/**",
      "**/.DS_Store",
      "dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: globals.browser,
      ecmaVersion: 2020,
      sourceType: "module",
    },
  },
];

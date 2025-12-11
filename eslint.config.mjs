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
    rules: {
      // Allow flexible typing in this codebase; many utilities use "any" for DB rows and sockets
      "@typescript-eslint/no-explicit-any": "off",
      // Allow unused vars (common in middleware signatures); rely on TS compiler instead
      "@typescript-eslint/no-unused-vars": "off",
      // Permit CommonJS require usage in this codebase
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: ["dist/", "node_modules/", "reference/", "coverage/", "*.tgz"]
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: 2022
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // The numerical kernel must stay dependency-free and side-effect-free;
      // keep DOM/worker globals out of core, accumulate, rotation, and model.
      "no-restricted-globals": ["error", "document", "window"],
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }]
    }
  },
  {
    files: ["src/plot/render.ts", "src/browser/**/*.ts"],
    rules: {
      "no-restricted-globals": "off"
    }
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      parserOptions: { sourceType: "module", ecmaVersion: 2022 }
    }
  }
];

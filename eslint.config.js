import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "templates/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/cli/**/*.ts"],
    rules: {
      complexity: ["error", { max: 20 }],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/cli/tests/**/*.ts"],
    rules: {
      complexity: ["error", { max: 25 }],
      "max-lines-per-function": ["error", { max: 120, skipBlankLines: true, skipComments: true }],
    },
  },
);

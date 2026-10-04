import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  prettier,
  globalIgnores([".next/**", "node_modules/**", "out/**", "dist/**", "coverage/**"]),
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    ignores: ["**/*.test.tsx", "components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...["button", "input", "select", "textarea", "table"].map((tag) => ({
          selector: `JSXOpeningElement[name.name='${tag}']`,
          message: `Use the shadcn/ui component for <${tag}> elements.`,
        })),
      ],
    },
  },
  {
    rules: {
      "import/order": [
        "error",
        {
          alphabetize: { caseInsensitive: true, order: "asc" },
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
          "newlines-between": "always",
          pathGroupsExcludedImportTypes: ["builtin"],
        },
      ],
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "function", next: "function" },
        { blankLine: "always", prev: "*", next: "return" },
        { blankLine: "always", prev: "*", next: "throw" },
      ],
    },
  },
]);

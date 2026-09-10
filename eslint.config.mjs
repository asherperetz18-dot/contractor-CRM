import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `const { company_id: _co, ...fields } = row` is how we drop a key
      // from an update payload; the discarded sibling is not dead code.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // e2e/ is Playwright test code, not React source -- its fixture API
    // has a parameter literally named `use` (test.extend({ ... async
    // (fixtures, use) => { await use(...) } })), which
    // eslint-plugin-react-hooks (pulled in by eslint-config-next for the
    // whole app) misreads as an unconditional call to React's `use()`
    // hook from a non-hook function. Real React rules don't apply here.
    files: ["e2e/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Original prototype, kept for reference only — not part of the app.
    "reference/**",
  ]),
]);

export default eslintConfig;

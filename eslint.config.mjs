import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Rules are being re-enabled step by step (see docs/AUDIT history). The ones
// still off below either don't fit this codebase or are left for a later pass.
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-non-null-assertion": "off", // used after explicit checks the compiler can't follow

    // React
    "react-hooks/exhaustive-deps": "warn",
    "react/no-unescaped-entities": "error",

    // Next.js: proof photos are served by /api/pod (auth-checked), not next/image.
    "@next/next/no-img-element": "off",

    // General JavaScript
    "prefer-const": "error",
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-case-declarations": "error",
    "no-fallthrough": "error",
    "no-unreachable": "error",
    "no-useless-escape": "error",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/**"]
}];

export default eslintConfig;

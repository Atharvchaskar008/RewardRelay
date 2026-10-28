/** Root ESLint config for the Node/TypeScript packages (contracts, shared). The web app has its own. */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  env: { node: true, es2022: true },
  ignorePatterns: [
    "node_modules/",
    "artifacts/",
    "cache/",
    "coverage/",
    "typechain-types/",
    ".next/",
    "dist/",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
  overrides: [{ files: ["packages/contracts/test/**/*.ts"], env: { mocha: true } }],
};

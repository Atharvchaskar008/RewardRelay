import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests: `npm test -w frontend` (no network, no emulators).
 * Emulator tests: `npm run test:emulators -w frontend` (Firebase Auth + Firestore emulators).
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: [
      process.env.VITEST_SUITE === "emulator"
        ? "test/emulator/**/*.test.ts"
        : "test/unit/**/*.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: process.env.VITEST_SUITE !== "emulator",
  },
});

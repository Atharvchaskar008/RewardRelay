import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests: `npm test -w @rewardrelay/web` (no network, no emulators).
 * Integration tests: `npm run test:integration -w @rewardrelay/web` (Firebase Auth + Firestore
 * emulators around the run; the global setup starts a local Hardhat node with fresh contracts).
 */
const emulatorSuite = process.env.VITEST_SUITE === "emulator";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: emulatorSuite
      ? ["test/emulator/**/*.test.ts", "test/integration/**/*.test.ts"]
      : ["test/unit/**/*.test.ts"],
    globalSetup: emulatorSuite ? ["test/integration/globalSetup.ts"] : [],
    testTimeout: emulatorSuite ? 120_000 : 30_000,
    hookTimeout: 120_000,
    fileParallelism: !emulatorSuite,
  },
});

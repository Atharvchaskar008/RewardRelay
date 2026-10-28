import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteApp, getApps } from "firebase-admin/app";
import { testEnv } from "../helpers/env";

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("firebase admin", () => {
  it("shares one Firestore instance between separately bundled copies of the module", async () => {
    for (const [name, value] of Object.entries(testEnv())) vi.stubEnv(name, value);

    // Next bundles each route with its own copy of src/server, while firebase-admin itself (an
    // external package) is loaded once per process. resetModules reproduces that split.
    vi.resetModules();
    const first = await import("@/server/firebaseAdmin");
    vi.resetModules();
    const second = await import("@/server/firebaseAdmin");
    expect(second).not.toBe(first);

    const a = first.db();
    const b = second.db();
    expect(b).toBe(a);
    // The settings apply: an undefined field is dropped instead of rejected (checked locally by set()).
    expect(() => b.batch().set(b.doc("probe/doc"), { kept: 1, dropped: undefined })).not.toThrow();
    // Two fresh imports of firebase-admin take seconds on a busy or freshly installed machine.
  }, 20_000);
});

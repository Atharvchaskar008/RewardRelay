import fs from "fs";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

/** Runs against the Firestore emulator started by `npm run test:integration -w @rewardrelay/web`. */

let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085").split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-rewardrelay",
    firestore: {
      host,
      port: Number(port),
      rules: fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "listings/1"), { title: "Rs 400 off with Bank A" });
    await setDoc(doc(db, "users/uid-alice"), { wallet: "0x1" });
    await setDoc(doc(db, "vault/0xabc"), { code: "sealed" });
    await setDoc(doc(db, "deals/1/private/details"), { blob: "sealed" });
  });
});

describe("firestore.rules", () => {
  it("lets anyone read listings", async () => {
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "listings/1")));
    await assertSucceeds(
      getDocs(collection(env.authenticatedContext("uid-alice").firestore(), "listings")),
    );
  });

  it("denies every client write, even to listings and even when signed in", async () => {
    const anon = env.unauthenticatedContext().firestore();
    const alice = env
      .authenticatedContext("uid-alice", { phone_number: "+16505550101" })
      .firestore();
    await assertFails(setDoc(doc(anon, "listings/2"), { title: "spoof" }));
    await assertFails(setDoc(doc(alice, "listings/1"), { title: "edited" }));
    await assertFails(deleteDoc(doc(alice, "listings/1")));
    await assertFails(setDoc(doc(alice, "users/uid-alice"), { wallet: "0x2" }));
  });

  it("denies reads of every server-only collection, including the user's own doc", async () => {
    const alice = env.authenticatedContext("uid-alice").firestore();
    for (const pathName of [
      "users/uid-alice",
      "vault/0xabc",
      "deals/1",
      "deals/1/private/details",
      "disputes/1",
      "idempotency/x",
      "rateLimits/x",
      "walletBackups/uid-alice",
    ]) {
      await assertFails(getDoc(doc(alice, pathName)));
    }
  });
});

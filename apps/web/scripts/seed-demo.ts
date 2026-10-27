/**
 * Seeds the demo marketplace with one offer per category, listed by a demo Sharer.
 *
 *   SEED_PHONE=+91… SEED_CODE=… SEED_PIN=… npm run seed:demo -w @rewardrelay/web
 *
 * - SEED_PHONE / SEED_CODE: a Firebase **test** phone number and its fixed code (never in the repo).
 * - SEED_PIN: the demo Sharer's wallet PIN (6-12 digits). The first run creates the wallet, links it
 *   and uploads the encrypted backup; later runs restore it from that backup.
 * - SEED_API_URL: the RewardRelay API to talk to (default http://localhost:3000).
 * Chain and Firebase settings come from apps/web/.env. Re-running only lists offers that are not open.
 * Every listing locks the Sharer's deposit: the script checks the balance first and stops with the
 * amount to send when it is too low.
 */
import { readFileSync } from "fs";
import path from "path";
import { parse } from "dotenv";
import { formatEther, parseEther, type Address } from "viem";
import { inrToWei } from "@rewardrelay/shared";
import {
  EmbeddedWallet,
  MemoryKeyStore,
  chainContext,
  createApiClient,
  onboardWallet,
  restoreWallet,
  type SdkContext,
} from "@/client/sdk";
import { DEMO_LISTINGS, seedDemoListings } from "./demo-listings";

/** Gas for one listing (createListing + publication) at 1 gwei, with headroom. */
const GAS_PER_LISTING = parseEther("0.0006");

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Set ${name} (see the comment at the top of scripts/seed-demo.ts).`);
  return value;
}

async function firebaseIdToken(apiKey: string, phone: string, code: string): Promise<string> {
  const call = async (method: string, body: unknown) => {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/${method}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, string> & { error?: { message: string } };
    if (!res.ok) throw new Error(`Firebase sign-in failed: ${json.error?.message ?? res.status}`);
    return json;
  };
  // Test phone numbers skip reCAPTCHA and SMS; real numbers are refused here on purpose.
  const { sessionInfo } = await call("accounts:sendVerificationCode", {
    phoneNumber: phone,
    recaptchaToken: "test",
  });
  return (await call("accounts:signInWithPhoneNumber", { sessionInfo, code })).idToken;
}

async function main(): Promise<void> {
  const fileEnv = parse(readFileSync(path.join(__dirname, "..", ".env")));
  const env = { ...fileEnv, ...process.env };
  const apiUrl = env.SEED_API_URL ?? "http://localhost:3000";
  const pin = required(env, "SEED_PIN");
  const idToken = await firebaseIdToken(
    required(env, "NEXT_PUBLIC_FIREBASE_API_KEY"),
    required(env, "SEED_PHONE"),
    required(env, "SEED_CODE"),
  );
  const api = createApiClient({ baseUrl: apiUrl, getIdToken: async () => idToken });

  const wallet = new EmbeddedWallet(new MemoryKeyStore());
  if (await api.me()) {
    await restoreWallet(api, wallet, pin);
    await wallet.unlock(pin);
  } else {
    await onboardWallet(api, wallet, pin);
  }
  const sharer: Address = wallet.getAccount().address;
  const chain = chainContext(
    {
      rpcUrl: required(env, "MST_RPC_URL"),
      chainId: Number(required(env, "MST_CHAIN_ID")),
      escrow: required(env, "ESCROW_ADDRESS") as Address,
      explorerUrl: env.MST_EXPLORER_URL ?? "https://testnet.mstscan.com",
    },
    wallet.getAccount(),
  );
  const rate = Number(env.DEMO_RATE_INR_PER_MSTC ?? 100_000);
  const sdk: SdkContext = { api, chain, inrPerMstc: rate };

  // New-tier Sharers lock 50% of the price; a higher tier locks less, so this is an upper bound.
  const needed = DEMO_LISTINGS.reduce(
    (sum, item) => sum + inrToWei(item.priceInr, rate) / 2n + GAS_PER_LISTING,
    0n,
  );
  const balance = await chain.publicClient.getBalance({ address: sharer });
  console.log(`Demo Sharer ${sharer}: balance ${formatEther(balance)} MSTC`);
  if (balance < needed) {
    console.log(
      `Send at least ${formatEther(needed - balance)} MSTC to ${sharer}, then run this again.`,
    );
    process.exitCode = 1;
    return;
  }

  const { created, skipped } = await seedDemoListings(sdk, sharer);
  for (const title of skipped) console.log(`already open: ${title}`);
  for (const dealId of created) console.log(`listed deal #${dealId}  ${apiUrl}/deal/${dealId}`);
  console.log(`Done: ${created.length} listed, ${skipped.length} already open.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  // The wallet's auto-lock timer would keep the process alive.
  .finally(() => process.exit());

/**
 * Creates packages/contracts/.env with a fresh DEPLOYER_KEY (only when none is set yet) and prints the
 * deployer ADDRESS. The private key is written to the local, git-ignored .env file and never printed.
 *
 * Usage: npm run deployer:generate -w @rewardrelay/contracts
 */
import fs from "fs";
import path from "path";
import { Wallet } from "ethers";

const ENV_PATH = path.join(__dirname, "..", ".env");
const EXAMPLE_PATH = path.join(__dirname, "..", ".env.example");
const KEY_LINE = /^DEPLOYER_KEY=(.*)$/m;

function main(): void {
  const current = fs.readFileSync(fs.existsSync(ENV_PATH) ? ENV_PATH : EXAMPLE_PATH, "utf8");
  const existing = current.match(KEY_LINE)?.[1]?.trim();

  if (existing) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(existing)) {
      throw new Error("DEPLOYER_KEY in .env is malformed. Fix or clear it, then rerun.");
    }
    console.log("DEPLOYER_KEY is already set; nothing generated.");
    console.log(`Deployer address: ${new Wallet(existing).address}`);
    return;
  }

  const wallet = Wallet.createRandom();
  const keyLine = `DEPLOYER_KEY=${wallet.privateKey}`;
  const updated = KEY_LINE.test(current)
    ? current.replace(KEY_LINE, () => keyLine)
    : `${current.trimEnd()}\n${keyLine}\n`;

  fs.writeFileSync(ENV_PATH, updated, { mode: 0o600 });
  console.log("Generated a fresh deployer key in packages/contracts/.env (not printed).");
  console.log(`Deployer address: ${wallet.address}`);
}

main();

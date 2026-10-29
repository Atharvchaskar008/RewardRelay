import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());
const CONTRACTS_DIR = resolve(ROOT, 'packages/contracts');
const WEB_DIR = resolve(ROOT, 'apps/web');

function run(cmd, cwd = ROOT) {
  console.log(`\n>>> [EXEC] ${cmd} (in ${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ALLOW_NEW_ADDRESSES: 'true', YES: 'true' } });
}

async function checkBalance() {
  console.log('--- Checking Balances on MST Mainnet ---');
  const checkScript = `
    const hre = require('hardhat');
    async function main() {
      const addresses = [
        { label: 'Deployer', addr: '0xE16066f38f89c67AC0B7F116FDDe894e5c4581F5' },
        { label: 'Verifier', addr: '0xE0b91d46Aa724269B3D66D62310167b9D44fFDCF' },
        { label: 'Funder  ', addr: '0xFFd3D4Ea89DE9Cd744c09d4869Df6adD5a8b9BfE' },
      ];
      for (const item of addresses) {
        const bal = await hre.ethers.provider.getBalance(item.addr);
        console.log(item.label + ' ' + item.addr + ' = ' + (Number(bal) / 1e18).toFixed(6) + ' MSTC');
      }
    }
    main();
  `;
  const file = resolve(CONTRACTS_DIR, 'scripts/_check.js');
  writeFileSync(file, checkScript);
  try {
    run('npx hardhat run scripts/_check.js --network mstMainnet', CONTRACTS_DIR);
  } finally {
    try { unlinkSync(file); } catch {}
  }
}

async function step1_deployContracts() {
  console.log('\n========================================');
  console.log('STEP 1: Deploying Contracts to MST Mainnet');
  console.log('========================================');
  process.env.ALLOW_NEW_ADDRESSES = 'true';
  process.env.YES = 'true';
  run('npx hardhat run scripts/deploy.ts --network mstMainnet', CONTRACTS_DIR);
}

async function step2_configureContracts() {
  console.log('\n========================================');
  console.log('STEP 2: Configuring Roles & Market Policies');
  console.log('========================================');
  run('npx hardhat run scripts/configure.ts --network mstMainnet', CONTRACTS_DIR);
}

async function step3_updateSharedAndWebEnv() {
  console.log('\n========================================');
  console.log('STEP 3: Syncing Deployment Records to Web');
  console.log('========================================');
  const recordPath = resolve(CONTRACTS_DIR, 'deployments/mstMainnet.json');
  if (!existsSync(recordPath)) {
    throw new Error('deployments/mstMainnet.json not found!');
  }
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const sbt = record.contracts.ReputationSBT.address;
  const escrow = record.contracts.RelayEscrow.address;
  console.log(`Mainnet ReputationSBT: ${sbt}`);
  console.log(`Mainnet RelayEscrow:   ${escrow}`);

  // Update apps/web/.env
  const webEnvPath = resolve(WEB_DIR, '.env');
  let webEnv = readFileSync(webEnvPath, 'utf8');
  webEnv = webEnv.replace(/ESCROW_ADDRESS=0x[0-9a-fA-F]{40}/, `ESCROW_ADDRESS=${escrow}`);
  webEnv = webEnv.replace(/SBT_ADDRESS=0x[0-9a-fA-F]{40}/, `SBT_ADDRESS=${sbt}`);
  webEnv = webEnv.replace(/NEXT_PUBLIC_ESCROW_ADDRESS=0x[0-9a-fA-F]{40}/, `NEXT_PUBLIC_ESCROW_ADDRESS=${escrow}`);
  writeFileSync(webEnvPath, webEnv);
  console.log('Updated apps/web/.env with live on-chain addresses.');
}

async function step4_verifyBuild() {
  console.log('\n========================================');
  console.log('STEP 4: Verifying Production Web Build');
  console.log('========================================');
  run('npm run build -w @rewardrelay/web', ROOT);
}

async function main() {
  const arg = process.argv[2] || 'all';
  if (arg === 'check') {
    await checkBalance();
    return;
  }
  if (arg === 'deploy') {
    await step1_deployContracts();
    return;
  }
  if (arg === 'configure') {
    await step2_configureContracts();
    return;
  }
  if (arg === 'sync') {
    await step3_updateSharedAndWebEnv();
    return;
  }
  if (arg === 'build') {
    await step4_verifyBuild();
    return;
  }

  console.log('Starting Full Autonomous Deployment Pipeline...');
  await checkBalance();
  await step1_deployContracts();
  await step2_configureContracts();
  await step3_updateSharedAndWebEnv();
  await step4_verifyBuild();
  console.log('\n🎉 ALL PIPELINE STEPS COMPLETED SUCCESSFULLY!');
}

main().catch((err) => {
  console.error('\n❌ Pipeline failed:', err.message);
  process.exit(1);
});

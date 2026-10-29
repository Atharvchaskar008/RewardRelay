# @rewardrelay/contracts

Solidity 0.8.24 (Shanghai EVM, OpenZeppelin 5.0.2) contracts for SAKER on MST Blockchain.

| Contract            | Purpose                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `RelayEscrow`       | Deals, deposits, deadlines, disputes and payouts; per-deal policy snapshot; EIP-712 Pass-on authorisation; push payouts with pull fallback |
| `ReputationSBT`     | Soulbound Trust Badge (ERC-5192): tiers, deal limits, completed deals, Relay Points                                                        |
| `mocks/EscrowActor` | Test-only attacker/receiver used by the adversarial tests                                                                                  |

The specification (state machine, money flows, invariants, roles, threat model, gas, static
analysis) is [docs/protocol.md](../../docs/protocol.md). The contracts' NatSpec refers to it by its
former name, `SPEC.md`; those comments are part of the deployed, verifiable source and stay unchanged.

## Scripts

| Command                                                                                     | Does                                                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run compile`                                                                           | Compile + TypeChain types                                                          |
| `npm test`                                                                                  | 100 tests: lifecycle, adversarial/reentrancy, randomized solvency invariant, badge |
| `npm run coverage`                                                                          | solidity-coverage (100% lines and branches)                                        |
| `npm run gas`                                                                               | Gas report                                                                         |
| `npm run slither`                                                                           | Static analysis (needs `slither` on PATH)                                          |
| `npm run deploy:<network>` / `configure:<network>` / `verify:<network>` / `smoke:<network>` | Idempotent deployment pipeline (`local`, `testnet`, `mainnet`)                     |

Deployment records are written to `deployments/<network>.json` (local runs to `*.local.json`, git-ignored),
and ABIs/addresses are exported to `packages/shared`. See [docs/deployment.md](../../docs/deployment.md).

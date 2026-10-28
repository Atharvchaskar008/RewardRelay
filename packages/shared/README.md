# @rewardrelay/shared

Code shared by the contracts scripts and the web app (consumed as TypeScript source).

| Module                                       | Contents                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `constants.ts`                               | Chain configs (MST Testnet/Mainnet, local), gas price, RPC relay paths                                  |
| `protocol.ts`                                | Enum mirrors of the contracts (status, deal type, party, on-chain action), status labels, EIP-712 types |
| `nextAction.ts`                              | `computeNextAction()`: the deal room's primary/secondary actions                                        |
| `listing.ts`                                 | Category labels, blocked topics, code normalisation, canonical terms JSON                               |
| `money.ts`                                   | Exact ₹ ↔ wei conversions at the demo rate                                                              |
| `abis.ts`, `deployments.ts`, `categories.ts` | **Generated** by `packages/contracts/scripts/deploy.ts`; do not edit by hand                            |

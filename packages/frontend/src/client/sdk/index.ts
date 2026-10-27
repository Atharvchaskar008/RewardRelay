/**
 * RewardRelay client SDK. The UI imports everything from here:
 * - `createApiClient` (typed API, envelope unwrapped, ApiError),
 * - `tx`: transaction helpers (`tx.createListing`, `tx.acceptListing`, … `tx.withdraw`) and wallet contexts,
 * - flows (`onboardWallet`, `listBuyForYou`, `listPassOn`, `payForDeal`, `deliverOrder`,
 *   `raiseDispute`, `runDealAction`),
 * - React hooks (`RewardRelayProvider`, `useMe`, `useWallet`, `useListings`, `useDeal`,
 *   `useDealAction`).
 */
export * from "./api";
export * from "./errors";
export * from "./types";
export * as tx from "./chain";
export {
  chainContext,
  discoverInjectedWallets,
  injectedChainContext,
  type ChainConfig,
  type ChainContext,
  type InjectedWallet,
  type TxOutcome,
} from "./chain";
export * from "./flows";
export * from "./hooks";
export {
  EmbeddedWallet,
  IndexedDbKeyStore,
  MemoryKeyStore,
  validatePin,
} from "@/src/client/wallet";

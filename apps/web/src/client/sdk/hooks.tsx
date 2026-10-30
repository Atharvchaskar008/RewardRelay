"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Address, EIP1193Provider } from "viem";
import { EmbeddedWallet, IndexedDbKeyStore } from "@/client/wallet";
import { clearWalletChoice, loadWalletChoice, saveWalletChoice } from "@/client/walletChoice";
import { createApiClient, type ApiClient } from "./api";
import {
  chainContext,
  discoverInjectedWallets,
  injectedChainContext,
  requestWalletAddress,
  type ChainConfig,
  type ChainContext,
  type InjectedWallet,
} from "./chain";
import { ChainError } from "./errors";
import {
  onboardInjectedWallet,
  onboardWallet,
  restoreWallet,
  runDealAction,
  sendDeliveryDetails,
  type DealAction,
  type DealActionInput,
  type SdkContext,
} from "./flows";
import type { DeliveryDetails } from "./types";

/**
 * React bindings of the SDK. Wrap the app in <RewardRelayProvider> (with a Firebase ID-token getter)
 * and use the hooks; components never touch viem, keys or the escrow ABI.
 */

export interface RewardRelayConfig {
  apiBaseUrl?: string;
  chain: ChainConfig;
  inrPerMstc: number;
}

export type SakerConfig = RewardRelayConfig;

/** A connected browser wallet (BridgeKey, MetaMask, …) and the context that signs through it. */
export interface BrowserWalletSession {
  name: string;
  rdns: string;
  address: Address;
  provider: EIP1193Provider;
  chain: ChainContext;
}

interface SdkState {
  config: RewardRelayConfig;
  /** The signed-in account (e.g. the Firebase uid): device wallet and wallet choice are kept per account. */
  accountId: string | null | undefined;
  api: ApiClient;
  wallet: EmbeddedWallet;
  browserWallet: BrowserWalletSession | null;
  setBrowserWallet: (session: BrowserWalletSession | null) => void;
  /** False until a remembered browser wallet has been reconnected (or found unavailable). */
  browserWalletReady: boolean;
}

const SdkReactContext = createContext<SdkState | null>(null);

export function RewardRelayProvider(props: {
  config: RewardRelayConfig;
  getIdToken: () => Promise<string | null>;
  /**
   * The signed-in account (e.g. the Firebase uid; null while signed out). With it, every account on
   * this device has its own wallet, so several people can use one browser. Without it, one wallet
   * per browser.
   */
  accountId?: string | null;
  wallet?: EmbeddedWallet;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const { config, getIdToken, accountId, wallet, queryClient, children } = props;
  const api = useMemo(
    () => createApiClient({ baseUrl: config.apiBaseUrl, getIdToken }),
    [config.apiBaseUrl, getIdToken],
  );
  const embedded = useMemo(
    () =>
      wallet ??
      new EmbeddedWallet(
        accountId === undefined
          ? undefined
          : new IndexedDbKeyStore(undefined, undefined, `account:${accountId ?? "signed-out"}`),
      ),
    [wallet, accountId],
  );
  // An account's unlocked key never outlives its session.
  useEffect(() => () => embedded.lock(), [embedded]);
  const client = useMemo(() => queryClient ?? new QueryClient(), [queryClient]);
  const [browserWallet, setBrowserWallet] = useState<BrowserWalletSession | null>(null);
  const [browserWalletReady, setBrowserWalletReady] = useState(false);

  // Reconnects a remembered browser wallet without any prompt: only when the wallet still exposes
  // the remembered account (eth_accounts). Otherwise the user reconnects from the login page.
  useEffect(() => {
    let live = true;
    setBrowserWallet(null);
    const choice = loadWalletChoice(accountId);
    if (choice?.kind !== "injected") {
      setBrowserWalletReady(true);
      return;
    }
    setBrowserWalletReady(false);
    void (async () => {
      try {
        const wallets = await discoverInjectedWallets();
        const match = wallets.find((candidate) => candidate.info.rdns === choice.rdns);
        if (!match) return;
        const accounts = (await match.provider.request({ method: "eth_accounts" })) as string[];
        if (!accounts.some((account) => account.toLowerCase() === choice.address.toLowerCase()))
          return;
        const chain = await injectedChainContext(config.chain, match.provider, choice.address);
        if (live) {
          setBrowserWallet({
            name: choice.name,
            rdns: choice.rdns,
            address: choice.address,
            provider: match.provider,
            chain,
          });
        }
      } catch {
        // Stays disconnected; the login page offers to reconnect.
      } finally {
        if (live) setBrowserWalletReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [config.chain, accountId]);

  // Switching to another account in the wallet ends the session: deals are signed only by the
  // account linked to the phone number.
  useEffect(() => {
    if (!browserWallet) return;
    const onAccounts = (accounts: string[]) => {
      if (
        !accounts.some((account) => account.toLowerCase() === browserWallet.address.toLowerCase())
      )
        setBrowserWallet(null);
    };
    browserWallet.provider.on?.("accountsChanged", onAccounts);
    return () => browserWallet.provider.removeListener?.("accountsChanged", onAccounts);
  }, [browserWallet]);

  const value = useMemo(
    () => ({
      config,
      accountId,
      api,
      wallet: embedded,
      browserWallet,
      setBrowserWallet,
      browserWalletReady,
    }),
    [config, accountId, api, embedded, browserWallet, browserWalletReady],
  );
  return (
    <QueryClientProvider client={client}>
      <SdkReactContext.Provider value={value}>{children}</SdkReactContext.Provider>
    </QueryClientProvider>
  );
}

export const SakerProvider = RewardRelayProvider;

export function useRewardRelay(): SdkState {
  const state = useContext(SdkReactContext);
  if (!state) throw new Error("Wrap the app in <SAKERProvider> or <RewardRelayProvider>.");
  return state;
}

export const useSaker = useRewardRelay;

/**
 * Context for flows/transactions: signs with the connected browser wallet, otherwise with the
 * embedded wallet (which must be unlocked).
 */
export function useSdkContext(): () => SdkContext {
  const { api, wallet, config, browserWallet } = useRewardRelay();
  return useCallback(
    () => ({
      api,
      chain: browserWallet?.chain ?? chainContext(config.chain, wallet.getAccount()),
      inrPerMstc: config.inrPerMstc,
    }),
    [api, wallet, config, browserWallet],
  );
}

/** The signed-in user's view (null until a wallet is linked). */
export function useMe() {
  const { api, accountId } = useRewardRelay();
  return useQuery({
    queryKey: ["me", accountId],
    queryFn: () => api.me(),
    staleTime: 10_000,
  });
}

export interface WalletState {
  ready: boolean;
  exists: boolean;
  unlocked: boolean;
  address: Address | null;
}

/**
 * Wallet lifecycle. The embedded wallet: create (+ link + backup), unlock, lock, backup, restore. A
 * browser wallet: connect (links it on first use), disconnect. `unlocked` means "can sign now".
 */
export function useWallet() {
  const { api, wallet, config, accountId, browserWallet, setBrowserWallet, browserWalletReady } =
    useRewardRelay();
  const queryClient = useQueryClient();
  const [state, setState] = useState<WalletState>({
    ready: false,
    exists: false,
    unlocked: false,
    address: null,
  });

  const refresh = useCallback(async () => {
    const address = await wallet.storedAddress();
    setState({ ready: true, exists: address !== null, unlocked: wallet.isUnlocked(), address });
  }, [wallet]);

  useEffect(() => {
    void refresh();
    return wallet.onLock(() => void refresh());
  }, [wallet, refresh]);

  const run = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } finally {
        await refresh();
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    },
    [refresh, queryClient],
  );

  return {
    ...state,
    ready: state.ready && browserWalletReady,
    kind: browserWallet ? ("injected" as const) : ("embedded" as const),
    unlocked: browserWallet !== null || state.unlocked,
    address: browserWallet?.address ?? state.address,
    /** The connected browser wallet's name (e.g. "MetaMask"), if any. */
    browserWalletName: browserWallet?.name ?? null,
    /**
     * Connects a browser wallet. Without `linkedAddress` it is linked to the phone account (signs the
     * challenge); with it, the wallet must expose that same account.
     */
    connectBrowserWallet: (picked: InjectedWallet, linkedAddress?: Address | null) =>
      run(async () => {
        let address: Address;
        if (linkedAddress) {
          address = await requestWalletAddress(picked.provider);
          if (address.toLowerCase() !== linkedAddress.toLowerCase()) {
            throw new ChainError(
              `Choose the account linked to SAKER in your wallet (${linkedAddress.slice(0, 6)}…${linkedAddress.slice(-4)}).`,
              "WrongAccount",
            );
          }
          const { token } = await api.auth.token(address);
          const { signInWithWalletToken } = await import("@/client/firebase");
          await signInWithWalletToken(token);
        } else {
          ({ address } = await onboardInjectedWallet(api, picked.provider, config.chain));
        }
        const chain = await injectedChainContext(config.chain, picked.provider, address);
        saveWalletChoice(
          { kind: "injected", rdns: picked.info.rdns, name: picked.info.name, address },
          accountId,
        );
        setBrowserWallet({
          name: picked.info.name,
          rdns: picked.info.rdns,
          address,
          provider: picked.provider,
          chain,
        });
      }),
    /** Forgets the browser wallet on this device (the account stays linked to it). */
    disconnectBrowserWallet: () => {
      clearWalletChoice(accountId);
      setBrowserWallet(null);
      void (async () => {
        const { signOut } = await import("@/client/firebase");
        await signOut();
      })();
    },
    /** Creates or unlocks the device wallet, links it to the phone account and uploads the backup. */
    create: (pin: string) => run(() => onboardWallet(api, wallet, pin)),
    unlock: (pin: string) => run(() => wallet.unlock(pin)),
    lock: () => wallet.lock(),
    backup: () => run(async () => api.wallet.putBackup(await wallet.exportBackup())),
    restore: (pin: string) => run(() => restoreWallet(api, wallet, pin)),
    forget: () => run(() => wallet.forget()),
  };
}

/** Browser wallets available in this browser (EIP-6963, or `window.ethereum`); null while looking. */
export function useBrowserWallets(): InjectedWallet[] | null {
  const [wallets, setWallets] = useState<InjectedWallet[] | null>(null);
  useEffect(() => {
    let live = true;
    void discoverInjectedWallets().then((found) => {
      if (live) setWallets(found);
    });
    return () => {
      live = false;
    };
  }, []);
  return wallets;
}

/** Public listings, paginated. */
export function useListings(filter: { category?: string; status?: "open" | "all" } = {}) {
  const { api } = useRewardRelay();
  return useInfiniteQuery({
    queryKey: ["listings", filter],
    queryFn: ({ pageParam }) => api.listings.list({ ...filter, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
  });
}

const ACTIVE = new Set(["Listed", "Locked", "Delivered", "Disputed"]);

/** One deal's view model, polled every 5 s while it is still active. */
/**
 * The deal view depends on who asks (role, next action, private panels), so it is cached per account:
 * a view fetched before the session was ready is refetched as soon as the account is known.
 */
export const dealQueryKey = (id: string | undefined, accountId: string | null | undefined) =>
  ["deal", id, accountId ?? null] as const;

export function useDeal(id: string | undefined) {
  const { api, accountId } = useRewardRelay();
  return useQuery({
    queryKey: dealQueryKey(id, accountId),
    queryFn: () => api.deals.get(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data && !ACTIVE.has(query.state.data.status) ? false : 5_000,
  });
}

/** Runs a deal button (`nextAction` or a secondary action) and refreshes the deal and the user. */
export function useDealAction(id: string) {
  const sdk = useSdkContext();
  const { accountId } = useRewardRelay();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, input }: { action: DealAction; input?: DealActionInput }) =>
      runDealAction(sdk(), { id }, action, input),
    onSuccess: (result) => {
      queryClient.setQueryData(dealQueryKey(id, accountId), result.deal);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["listings"] });
    },
  });
}

/** Seeker of a paid Buy-for-you deal: sends the delivery address when it was not sent with PAY. */
export function useSendDeliveryDetails(id: string) {
  const sdk = useSdkContext();
  const { accountId } = useRewardRelay();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (details: DeliveryDetails) => sendDeliveryDetails(sdk(), id, details),
    onSuccess: (deal) => queryClient.setQueryData(dealQueryKey(id, accountId), deal),
  });
}

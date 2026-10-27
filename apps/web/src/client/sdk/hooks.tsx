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
import type { Address } from "viem";
import { EmbeddedWallet } from "@/client/wallet";
import { createApiClient, type ApiClient } from "./api";
import { chainContext, type ChainConfig } from "./chain";
import {
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

interface SdkState {
  config: RewardRelayConfig;
  api: ApiClient;
  wallet: EmbeddedWallet;
}

const SdkReactContext = createContext<SdkState | null>(null);

export function RewardRelayProvider(props: {
  config: RewardRelayConfig;
  getIdToken: () => Promise<string | null>;
  wallet?: EmbeddedWallet;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const { config, getIdToken, wallet, queryClient, children } = props;
  const api = useMemo(
    () => createApiClient({ baseUrl: config.apiBaseUrl, getIdToken }),
    [config.apiBaseUrl, getIdToken],
  );
  const embedded = useMemo(() => wallet ?? new EmbeddedWallet(), [wallet]);
  const client = useMemo(() => queryClient ?? new QueryClient(), [queryClient]);
  const value = useMemo(() => ({ config, api, wallet: embedded }), [config, api, embedded]);
  return (
    <QueryClientProvider client={client}>
      <SdkReactContext.Provider value={value}>{children}</SdkReactContext.Provider>
    </QueryClientProvider>
  );
}

export function useRewardRelay(): SdkState {
  const state = useContext(SdkReactContext);
  if (!state) throw new Error("Wrap the app in <RewardRelayProvider>.");
  return state;
}

/** Context for flows/transactions; requires the embedded wallet to be unlocked. */
export function useSdkContext(): () => SdkContext {
  const { api, wallet, config } = useRewardRelay();
  return useCallback(
    () => ({
      api,
      chain: chainContext(config.chain, wallet.getAccount()),
      inrPerMstc: config.inrPerMstc,
    }),
    [api, wallet, config],
  );
}

/** The signed-in user's view (null until a wallet is linked). */
export function useMe() {
  const { api } = useRewardRelay();
  return useQuery({ queryKey: ["me"], queryFn: () => api.me() });
}

export interface WalletState {
  ready: boolean;
  exists: boolean;
  unlocked: boolean;
  address: Address | null;
}

/** Embedded wallet lifecycle: create (+ link + backup), unlock, lock, backup, restore. */
export function useWallet() {
  const { api, wallet } = useRewardRelay();
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
    /** Creates or unlocks the device wallet, links it to the phone account and uploads the backup. */
    create: (pin: string) => run(() => onboardWallet(api, wallet, pin)),
    unlock: (pin: string) => run(() => wallet.unlock(pin)),
    lock: () => wallet.lock(),
    backup: () => run(async () => api.wallet.putBackup(await wallet.exportBackup())),
    restore: (pin: string) => run(() => restoreWallet(api, wallet, pin)),
    forget: () => run(() => wallet.forget()),
  };
}

/** Public listings, paginated. */
export function useListings(filter: { category?: string; status?: "open" | "all" } = {}) {
  const { api } = useRewardRelay();
  return useInfiniteQuery({
    queryKey: ["listings", filter],
    queryFn: ({ pageParam }) => api.listings.list({ ...filter, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

const ACTIVE = new Set(["Listed", "Locked", "Delivered", "Disputed"]);

/** One deal's view model, polled every 5 s while it is still active. */
export function useDeal(id: string | undefined) {
  const { api } = useRewardRelay();
  return useQuery({
    queryKey: ["deal", id],
    queryFn: () => api.deals.get(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data && !ACTIVE.has(query.state.data.status) ? false : 5_000,
  });
}

/** Runs a deal button (`nextAction` or a secondary action) and refreshes the deal and the user. */
export function useDealAction(id: string) {
  const sdk = useSdkContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, input }: { action: DealAction; input?: DealActionInput }) =>
      runDealAction(sdk(), { id }, action, input),
    onSuccess: (result) => {
      queryClient.setQueryData(["deal", id], result.deal);
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["listings"] });
    },
  });
}

/** Seeker of a paid Buy-for-you deal: sends the delivery address when it was not sent with PAY. */
export function useSendDeliveryDetails(id: string) {
  const sdk = useSdkContext();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (details: DeliveryDetails) => sendDeliveryDetails(sdk(), id, details),
    onSuccess: (deal) => queryClient.setQueryData(["deal", id], deal),
  });
}

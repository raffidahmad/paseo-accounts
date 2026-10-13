import type { PluginRpcContract } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import { useSyncExternalStore } from "react";
import type { StateView } from "../shared/model";
import { getState } from "../shared/rpc";

const IDLE_POLL_MS = 20_000;
/** While the Accounts screen is open, so usage moves as agents use it. */
export const VISIBLE_POLL_MS = 4_000;
const ACTIVE_POLL_MS = 1_500;

export interface StoreSnapshot {
  state: StateView | null;
  error: string | null;
}

export interface AccountsStore {
  start(): void;
  stop(): void;
  /** Calls a daemon handler, then refreshes state so every view sees the result. */
  rpc<InputSchema extends ZodType, OutputSchema extends ZodType>(
    contract: PluginRpcContract<InputSchema, OutputSchema>,
    input: ZodInput<InputSchema>,
  ): Promise<ZodOutput<OutputSchema>>;
  readonly current: StoreSnapshot;
  subscribe(listener: () => void): () => void;
  getSnapshot(): StoreSnapshot;
  /** Poll at least this often until the returned function is called. */
  watch(intervalMs: number): () => void;
  /** Poll quickly while something (a sign-in flow) is waiting on the daemon. */
  watchClosely(): () => void;
  refresh(options?: { refreshUsage?: boolean; fresh?: boolean }): Promise<void>;
}

/**
 * One poller per installation feeds the Accounts screen. Polling is cheap: the daemon answers from
 * memory and refreshes usage on its own schedule.
 *
 * A factory, not a class: Paseo evaluates the client bundle with `eval` on mobile, where Hermes
 * can't construct a class defined in evaluated code ("Cannot read property 'prototype' of undefined").
 */
export function createAccountsStore(client: PluginClientContext): AccountsStore {
  let snapshot: StoreSnapshot = { state: null, error: null };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let issued = 0;
  let published = 0;
  let stopped = false;
  /** Poll intervals wanted by open views; the shortest wins. */
  const watchers: number[] = [];

  function publish(next: StoreSnapshot): void {
    if (stopped) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  function schedule(): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const loginActive = snapshot.state?.logins.some((login) => isOpen(login.step)) ?? false;
    const delay = Math.min(IDLE_POLL_MS, loginActive ? ACTIVE_POLL_MS : IDLE_POLL_MS, ...watchers);
    timer = setTimeout(() => void refresh(), delay);
  }

  function refresh(options: { refreshUsage?: boolean; fresh?: boolean } = {}): Promise<void> {
    if (inFlight && !options.refreshUsage) {
      if (!options.fresh) return inFlight;
      return inFlight.then(() => refresh({ refreshUsage: options.refreshUsage }));
    }
    const sequence = ++issued;
    const run: Promise<void> = client
      .rpc(getState, { refreshUsage: options.refreshUsage })
      .then((state) => {
        // An older, slower answer must not overwrite a newer one.
        if (sequence >= published) {
          published = sequence;
          publish({ state, error: null });
        }
      })
      .catch((error: unknown) => {
        if (sequence >= published) publish({ state: snapshot.state, error: describe(error) });
      })
      .finally(() => {
        if (inFlight === run) inFlight = null;
        schedule();
      });
    inFlight = run;
    return run;
  }

  function watch(intervalMs: number): () => void {
    watchers.push(intervalMs);
    schedule();
    let watching = true;
    return () => {
      if (!watching) return;
      watching = false;
      const index = watchers.indexOf(intervalMs);
      if (index >= 0) watchers.splice(index, 1);
      schedule();
    };
  }

  return {
    start() {
      void refresh();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      listeners.clear();
    },
    async rpc(contract, input) {
      try {
        return await client.rpc(contract, input);
      } finally {
        // A poll already in flight started before this action, so ask again once it lands.
        void refresh({ fresh: true });
      }
    },
    get current() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    watch,
    watchClosely: () => watch(ACTIVE_POLL_MS),
    refresh,
  };
}

function isOpen(step: string): boolean {
  return step === "starting" || step === "waiting" || step === "verifying";
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useStore(store: AccountsStore): StoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

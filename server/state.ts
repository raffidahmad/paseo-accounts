import { copyFile } from "node:fs/promises";
import { z } from "zod";
import { AccountKindSchema } from "../shared/model";
import { Mutex, readJson, writeJsonAtomic } from "./json-file";
import { statePath } from "./paths";

/**
 * An account Paseo Accounts added. It is also a provider entry in Paseo's config (`providers.<id>`), which
 * is the source of truth for the label and environment; this registry holds what Paseo can't:
 * the credential home and the identity learned from signing in.
 */
export const StoredAccountSchema = z.object({
  /** The Paseo provider ID, and the name of the credential home's folder. */
  id: z.string(),
  /** The built-in provider this account extends. */
  base: z.string(),
  label: z.string(),
  /** The label was generated from the email and may be replaced when the identity is learned. */
  autoLabel: z.boolean().default(true),
  kind: AccountKindSchema,
  /** Credential home (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`). `null` for the base login and env-only accounts. */
  home: z.string().nullable(),
  /** The provider has no adapter: sign-in and usage are the user's business. */
  envOnly: z.boolean().default(false),
  email: z.string().nullable().default(null),
  plan: z.string().nullable().default(null),
  organization: z.string().nullable().default(null),
  /** Stable identity used to spot the same account being added twice. */
  identity: z.string().nullable().default(null),
  signedIn: z.boolean().default(true),
  createdAt: z.string(),
});
export type StoredAccount = z.infer<typeof StoredAccountSchema>;

export const StoredStateSchema = z.object({
  version: z.literal(2).default(2),
  accounts: z.array(StoredAccountSchema).default([]),
});
export type StoredState = z.infer<typeof StoredStateSchema>;

export function emptyState(): StoredState {
  return StoredStateSchema.parse({});
}

/** Keeps every account that still validates, so one bad record can't wipe the rest. */
export function salvageState(raw: unknown): { state: StoredState; dropped: boolean } {
  const whole = StoredStateSchema.safeParse(raw);
  if (whole.success) return { state: whole.data, dropped: false };
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let dropped = false;
  const accounts: StoredAccount[] = [];
  for (const entry of Array.isArray(source.accounts) ? source.accounts : []) {
    const parsed = StoredAccountSchema.safeParse(entry);
    if (parsed.success) accounts.push(parsed.data);
    else dropped = true;
  }
  return { state: { version: 2, accounts }, dropped: true };
}

/** The registry: small, written atomically. */
export class StateStore {
  private cached: StoredState | null = null;
  private readonly mutex = new Mutex();

  constructor(private readonly path: string = statePath()) {}

  async read(): Promise<StoredState> {
    if (this.cached) return this.cached;
    return this.mutex.run(async () => {
      if (!this.cached) this.cached = await this.load();
      return this.cached;
    });
  }

  /** Applies `change` to a copy and persists it. Returns the new state. */
  update(change: (draft: StoredState) => void): Promise<StoredState> {
    return this.mutex.run(async () => {
      const current = this.cached ?? (await this.load());
      const draft = structuredClone(current);
      change(draft);
      const next = StoredStateSchema.parse(draft);
      await writeJsonAtomic(this.path, next);
      this.cached = next;
      return next;
    });
  }

  /** Throws on a transient read error so nothing overwrites a file that couldn't be read. */
  private async load(): Promise<StoredState> {
    let raw: unknown;
    try {
      raw = await readJson(this.path);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      await this.backup("unparseable");
      return emptyState();
    }
    if (raw === undefined) return emptyState();
    const { state, dropped } = salvageState(raw);
    if (dropped) await this.backup("partly invalid");
    return state;
  }

  private async backup(why: string): Promise<void> {
    const copy = `${this.path}.bad-${Date.now()}`;
    await copyFile(this.path, copy).catch(() => undefined);
    console.error(`[paseo-accounts] state file was ${why}; kept a copy at ${copy} and continued with what was readable`);
  }
}

export function findAccount(state: StoredState, accountId: string | null | undefined): StoredAccount | undefined {
  return accountId ? state.accounts.find((account) => account.id === accountId) : undefined;
}

export function accountsOf(state: StoredState, base: string): StoredAccount[] {
  return state.accounts.filter((account) => account.base === base);
}

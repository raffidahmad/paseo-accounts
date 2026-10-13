import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { PluginHookContext, PluginSessionOpenRequest } from "@getpaseo/plugin/server";
import type { AccountView, BaseProvider, LoginMethod, LoginView, StateView, Usage } from "../shared/model";
import { DEFAULT_PREFERENCES, type Preferences } from "../shared/preferences";
import {
  providerEnv,
  type Identity,
  type LoginHandle,
  type ProviderAdapter,
  type UsageRead,
} from "./adapter";
import { removeHome } from "./homes";
import { Mutex } from "./json-file";
import { canSignInWithBrowser } from "./machine";
import { homesDir } from "./paths";
import {
  ConfigSync,
  accountProviderEntry,
  accountProviderId,
  configFacts,
  listBaseProviders,
  providerLabel,
  renameProfile,
  withProfile,
  withoutProfiles,
  type ProviderEntry,
} from "./providers";
import { StateStore, accountsOf, findAccount, type StoredAccount, type StoredState } from "./state";
import { loadReadings, mergeUsage, saveReadings } from "./usage";

type PaseoApi = PluginHookContext["paseo"];

/** How often to read usage: accounts whose agents just ran, and the rest. Adapters space reads further. */
const USAGE_BUSY_MS = 60_000;
const USAGE_IDLE_MS = 10 * 60_000;
/** An account counts as in use for this long after one of its agents ends a turn. */
const ACTIVE_WINDOW_MS = 15 * 60_000;
const UPKEEP_MS = 30_000;
const IDENTITY_MS = 30 * 60_000;
const AVAILABILITY_MS = 10 * 60_000;
const LOGIN_TTL_MS = 15 * 60_000;
const LOGIN_GRACE_MS = 3_000;
/** A window this full counts as a limit. */
const FULL_PERCENT = 100;

interface LoginSession {
  id: string;
  base: string;
  /** Existing account being signed back in. */
  accountId: string | null;
  /** Where the CLI writes credentials; null for the CLI's own login. */
  home: string | null;
  handle: LoginHandle | null;
  view: LoginView;
  finishedAt: number | null;
}

export class Service {
  private paseo: PaseoApi | null = null;
  private prefs: Preferences = DEFAULT_PREFERENCES;
  private readonly usage = new Map<string, Usage>();
  private readonly usageAttemptAt = new Map<string, number>();
  private readonly usageInFlight = new Map<string, Promise<void>>();
  private readonly usageRetryAt = new Map<string, number>();
  private readonly identityCheckedAt = new Map<string, number>();
  private readonly activeAt = new Map<string, number>();
  private readonly availability = new Map<string, { ok: boolean; detail: string | null; at: number }>();
  private readonly baseLabels = new Map<string, string>();
  private readonly logins = new Map<string, LoginSession>();
  private readonly loginLock = new Mutex();
  private readonly browserSignIn = canSignInWithBrowser();
  private usageSave: ReturnType<typeof setTimeout> | null = null;
  private reconciled = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly adapters: Record<string, ProviderAdapter>,
    private readonly store = new StateStore(),
    private readonly config = new ConfigSync(),
  ) {}

  setPreferences(prefs: Preferences): void {
    this.prefs = prefs;
  }

  /** Remember the plugin's SDK connection for background work. */
  attach(paseo: PaseoApi): void {
    this.paseo ??= paseo;
    if (!this.reconciled) {
      this.reconciled = true;
      void this.reconcile(paseo).catch((error: unknown) => {
        this.reconciled = false;
        log("could not sync accounts with Paseo's providers", error);
      });
    }
  }

  async start(): Promise<void> {
    for (const [accountId, reading] of await loadReadings()) if (!this.usage.has(accountId)) this.usage.set(accountId, reading);
    await Promise.all(Object.keys(this.adapters).map((base) => this.ensureMain(base)));
    this.timer = setInterval(() => void this.tick().catch((error: unknown) => log("upkeep failed", error)), UPKEEP_MS);
    this.timer.unref?.();
    void this.tick().catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.usageSave) {
      clearTimeout(this.usageSave);
      await saveReadings(this.usage).catch(() => undefined);
    }
    for (const login of this.logins.values()) login.handle?.cancel();
  }

  // ------------------------------------------------------------------ upkeep

  /** Checks the CLI is installed and registers the base provider's own login as an account. */
  private async ensureMain(base: string): Promise<void> {
    const adapter = this.adapters[base];
    if (!adapter) return;
    const availability = await adapter.available().catch((error: unknown) => ({ ok: false, detail: describe(error) }));
    this.availability.set(base, { ...availability, at: Date.now() });
    if (!availability.ok) return;
    const identity = await adapter.identity(null).catch(() => null);
    this.identityCheckedAt.set(base, Date.now());
    await this.store.update((draft) => {
      let main = findAccount(draft, base);
      if (!main) {
        main = newAccount({ id: base, base, kind: "main", home: null, envOnly: false });
        main.signedIn = false;
        draft.accounts.unshift(main);
      }
      if (identity) applyIdentity(main, identity);
      if (!main.label) main.label = "CLI login";
    });
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const now = Date.now();
    for (const [base, availability] of this.availability) {
      if (!availability.ok && now - availability.at > AVAILABILITY_MS) void this.ensureMain(base).catch(() => undefined);
    }
    for (const account of (await this.store.read()).accounts) {
      if (account.envOnly) continue;
      const busy = now - (this.activeAt.get(account.id) ?? 0) < ACTIVE_WINDOW_MS;
      if (account.signedIn && now - (this.usageAttemptAt.get(account.id) ?? 0) > (busy ? USAGE_BUSY_MS : USAGE_IDLE_MS)) {
        void this.refreshUsage(account.id).catch((error: unknown) => log(`usage refresh for ${account.label} failed`, error));
      }
      if (now - (this.identityCheckedAt.get(account.id) ?? 0) > IDENTITY_MS) void this.refreshIdentity(account.id).catch(() => undefined);
    }
    for (const [id, login] of this.logins) {
      if (login.finishedAt && now - login.finishedAt > LOGIN_TTL_MS) this.logins.delete(id);
      else if (!login.finishedAt && now - Date.parse(login.view.startedAt) > LOGIN_TTL_MS) void this.cancelLogin(id);
    }
  }

  private async refreshIdentity(accountId: string): Promise<void> {
    this.identityCheckedAt.set(accountId, Date.now());
    const account = findAccount(await this.store.read(), accountId);
    const adapter = account && this.adapters[account.base];
    if (!account || !adapter || account.envOnly) return;
    const identity = await adapter.identity(account.home).catch(() => null);
    if (!identity) return;
    await this.store.update((draft) => {
      const target = findAccount(draft, accountId);
      if (target) applyIdentity(target, identity);
    });
  }

  /**
   * Makes Paseo's config match the registry: an account whose provider entry is missing (config
   * reset, restored backup) gets it back, an env-only account Paseo no longer has is forgotten, and
   * an entry's environment follows the adapter. A user's own edits to the label, `enabled` and
   * `order` are left alone.
   */
  private async reconcile(paseo: PaseoApi): Promise<void> {
    const { providers } = await this.config.read(paseo);
    const state = await this.store.read();
    const gone: string[] = [];
    for (const account of state.accounts) {
      if (account.kind !== "managed") continue;
      const existing = providers[account.id];
      const adapter = this.adapters[account.base];
      if (account.envOnly || !adapter || !account.home) {
        if (!existing) gone.push(account.id);
        continue;
      }
      const env = providerEnv(await adapter.env(account.home));
      const wanted = accountProviderEntry({ base: account.base, baseLabel: this.baseLabel(account.base), label: account.label, env });
      if (!existing) {
        await this.config.upsertProvider(paseo, account.id, wanted);
        console.log(`[paseo-accounts] restored the provider for ${account.label}`);
      } else if (JSON.stringify(existing.env ?? {}) !== JSON.stringify(env)) {
        await this.config.upsertProvider(paseo, account.id, { ...wanted, label: typeof existing.label === "string" ? existing.label : wanted.label });
      }
    }
    if (gone.length > 0) {
      await this.store.update((draft) => {
        draft.accounts = draft.accounts.filter((account) => !gone.includes(account.id));
      });
    }
  }

  // ------------------------------------------------------------------ hooks

  /**
   * Account providers carry their own environment in Paseo's config, so a session needs nothing
   * from here but a fresh view of what the account shares with the CLI's main home.
   */
  async onSessionOpen(request: PluginSessionOpenRequest, context: PluginHookContext): Promise<void> {
    this.attach(context.paseo);
    const account = findAccount(await this.store.read(), request.provider);
    const adapter = account && this.adapters[account.base];
    if (!account?.home || !adapter) return;
    await adapter.prepareHome(account.home).catch((error: unknown) => log(`could not refresh the home of ${account.label}`, error));
  }

  /** A turn used the account: read its usage again as soon as the provider allows. */
  async onTurnEnded(agent: { provider: string }, context: PluginHookContext): Promise<void> {
    this.attach(context.paseo);
    const account = findAccount(await this.store.read(), agent.provider);
    if (!account || account.envOnly) return;
    this.activeAt.set(account.id, Date.now());
    void this.refreshUsage(account.id).catch(() => undefined);
  }

  // ------------------------------------------------------------------ usage

  /** `renewLogin` lets the CLI refresh an expired sign-in first (explicit refreshes only: it's slow). */
  refreshUsage(accountId: string, force = false, renewLogin = false): Promise<void> {
    const pending = this.usageInFlight.get(accountId);
    if (pending) return pending;
    const now = Date.now();
    // The provider asked us to wait; asking sooner would only be refused again.
    if (now < (this.usageRetryAt.get(accountId) ?? 0)) return Promise.resolve();
    const since = now - (this.usageAttemptAt.get(accountId) ?? 0);
    const task = (async () => {
      const account = findAccount(await this.store.read(), accountId);
      const adapter = account && this.adapters[account.base];
      if (!account || !adapter || account.envOnly) return;
      if (since < (force ? adapter.usageSpacingMs : Math.max(adapter.usageSpacingMs, 60_000))) return;
      this.usageAttemptAt.set(accountId, Date.now());
      const { retryAt, ...usage } = await adapter
        .usage(account.home, { renewLogin })
        .catch((error: unknown): UsageRead => ({ fetchedAt: new Date().toISOString(), windows: [], error: describe(error), cached: false }));
      if (retryAt) this.usageRetryAt.set(accountId, retryAt);
      else this.usageRetryAt.delete(accountId);
      this.setUsage(accountId, mergeUsage(this.usage.get(accountId), usage));
    })().finally(() => this.usageInFlight.delete(accountId));
    this.usageInFlight.set(accountId, task);
    return task;
  }

  /** Records a reading and saves the readings shortly after, so a restart shows them straight away. */
  private setUsage(accountId: string, usage: Usage | null): void {
    if (usage) this.usage.set(accountId, usage);
    else this.usage.delete(accountId);
    if (this.usageSave) return;
    this.usageSave = setTimeout(() => {
      this.usageSave = null;
      void saveReadings(this.usage).catch((error: unknown) => log("could not save usage", error));
    }, 3_000);
    this.usageSave.unref?.();
  }

  // ------------------------------------------------------------------ RPC: state

  async view(paseo: PaseoApi, refreshUsage = false): Promise<StateView> {
    this.attach(paseo);
    if (refreshUsage) {
      const state = await this.store.read();
      await Promise.allSettled(state.accounts.map((account) => this.refreshUsage(account.id, true, true)));
    }
    const state = await this.store.read();
    const [{ providers, profiles }, bases] = await Promise.all([
      this.config.read(paseo).catch(() => ({ providers: {}, profiles: [] })),
      this.bases(paseo, state),
    ]);
    const known = new Set(bases.map((base) => base.id));
    const accounts: AccountView[] = state.accounts
      .filter((account) => known.has(account.base))
      .map((account) => {
        const usage = this.usage.get(account.id) ?? null;
        const full = usage?.windows.some((window) => window.usedPercent >= FULL_PERCENT) ?? false;
        return {
          id: account.id,
          base: account.base,
          label: account.label,
          kind: account.kind,
          email: account.email,
          plan: account.plan,
          organization: account.organization,
          status: !account.signedIn ? "signed_out" : full ? "limited" : "ready",
          managedLogin: !account.envOnly,
          usage,
          home: account.home,
          ...configFacts(account.id, providers, profiles),
        };
      });
    return {
      accounts,
      bases,
      logins: [...this.logins.values()].map((login) => login.view),
      browserSignIn: this.browserSignIn,
      warnings: this.warnings(),
    };
  }

  /** Built-in Paseo providers, so a provider Paseo adds later is offered without any change here. */
  private async bases(paseo: PaseoApi, state: StoredState): Promise<BaseProvider[]> {
    let bases: BaseProvider[];
    try {
      const { entries } = await paseo.providers.snapshot();
      const managed = new Set(state.accounts.filter((account) => account.kind === "managed").map((account) => account.id));
      bases = listBaseProviders(entries, managed, (id) => id in this.adapters);
    } catch (error) {
      log("could not list Paseo's providers", error);
      bases = Object.keys(this.adapters).map((id) => ({ id, label: this.baseLabel(id), managedLogin: true }));
    }
    for (const base of bases) this.baseLabels.set(base.id, base.label);
    return bases;
  }

  private baseLabel(base: string): string {
    return this.baseLabels.get(base) ?? base.charAt(0).toUpperCase() + base.slice(1);
  }

  private warnings(): string[] {
    const warnings: string[] = [];
    for (const [base, availability] of this.availability) {
      if (!availability.ok) {
        warnings.push(
          `${this.baseLabel(base)} isn't installed where the daemon can run it${availability.detail ? ` (${availability.detail})` : ""}. Install it to add ${this.baseLabel(base)} accounts.`,
        );
      }
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY) {
      warnings.push(
        "The daemon's environment sets a Claude API key or token. Agents on your CLI login use it; agents on added accounts use their own sign-in.",
      );
    }
    if (process.env.CODEX_ACCESS_TOKEN) {
      warnings.push("The daemon's environment sets CODEX_ACCESS_TOKEN. Codex agents on your CLI login use it instead of a ChatGPT sign-in.");
    }
    return warnings;
  }

  // ------------------------------------------------------------------ RPC: accounts

  /** Creates the account's provider entry in Paseo, and its profile unless the user turned that off. */
  private async publish(paseo: PaseoApi, account: StoredAccount, entry: ProviderEntry): Promise<void> {
    await this.config.upsertProvider(paseo, account.id, entry);
    if (this.prefs.createProfiles) await this.config.editProfiles(paseo, (profiles) => withProfile(profiles, account.id, entry.label));
  }

  /** An account on a provider without managed sign-in: a name and the environment it runs with. */
  async addEnvAccount(paseo: PaseoApi, base: string, label: string, env: Record<string, string>): Promise<{ accountId: string }> {
    this.attach(paseo);
    const bases = await this.bases(paseo, await this.store.read());
    if (!bases.some((entry) => entry.id === base)) throw new Error("Paseo doesn't have that provider.");
    if (base in this.adapters) throw new Error(`${this.baseLabel(base)} accounts are added by signing in.`);
    const id = accountProviderId(base, randomBytes(4).toString("hex"));
    const account = newAccount({ id, base, kind: "managed", home: null, envOnly: true });
    account.label = label;
    account.autoLabel = false;
    await this.publish(paseo, account, accountProviderEntry({ base, baseLabel: this.baseLabel(base), label, env }));
    await this.store.update((draft) => {
      draft.accounts.push(account);
    });
    return { accountId: id };
  }

  async rename(paseo: PaseoApi, accountId: string, label: string): Promise<void> {
    this.attach(paseo);
    const account = findAccount(await this.store.read(), accountId);
    if (!account) throw new Error("That account no longer exists.");
    const before = providerLabel(this.baseLabel(account.base), account.label);
    const after = providerLabel(this.baseLabel(account.base), label);
    if (account.kind === "managed") {
      const { providers } = await this.config.read(paseo);
      const existing = providers[accountId];
      if (existing) await this.config.upsertProvider(paseo, accountId, { ...(existing as unknown as ProviderEntry), label: after });
      await this.config.editProfiles(paseo, (profiles) => renameProfile(profiles, accountId, before, after));
    }
    await this.store.update((draft) => {
      const target = findAccount(draft, accountId);
      if (!target) return;
      target.label = label;
      target.autoLabel = false;
    });
  }

  async remove(paseo: PaseoApi, accountId: string): Promise<void> {
    this.attach(paseo);
    const account = findAccount(await this.store.read(), accountId);
    if (!account) throw new Error("That account no longer exists.");
    if (account.kind === "main") {
      throw new Error("The CLI's own login can't be removed here. Sign out with its own command instead, e.g. `claude auth logout`.");
    }
    // Paseo first, so nothing can start on an account that is being signed out.
    await this.config.removeProvider(paseo, accountId);
    await this.config.editProfiles(paseo, (profiles) => withoutProfiles(profiles, accountId));
    await this.store.update((draft) => {
      draft.accounts = draft.accounts.filter((entry) => entry.id !== accountId);
    });
    this.setUsage(accountId, null);
    if (account.home) await this.discardHome(account.base, account.home);
  }

  async setProfile(paseo: PaseoApi, accountId: string, enabled: boolean): Promise<void> {
    this.attach(paseo);
    const account = findAccount(await this.store.read(), accountId);
    if (!account) throw new Error("That account no longer exists.");
    const name = account.kind === "main" ? `${this.baseLabel(account.base)}` : providerLabel(this.baseLabel(account.base), account.label);
    await this.config.editProfiles(paseo, (profiles) =>
      enabled ? withProfile(profiles, accountId, name) : withoutProfiles(profiles, accountId),
    );
  }

  /** Signs a home out and deletes it. Only ever called for a home Paseo Accounts made and nothing uses. */
  private async discardHome(base: string, home: string): Promise<void> {
    await this.adapters[base]?.logout(home).catch((error: unknown) => log(`signing out ${home} failed`, error));
    await removeHome(home).catch((error: unknown) => log(`could not delete ${home}`, error));
  }

  // ------------------------------------------------------------------ RPC: sign-in

  startLogin(paseo: PaseoApi, base: string, method: LoginMethod, accountId?: string): Promise<LoginView> {
    this.attach(paseo);
    return this.loginLock.run(() => this.beginLogin(base, method, accountId));
  }

  private async beginLogin(base: string, method: LoginMethod, accountId?: string): Promise<LoginView> {
    const adapter = this.adapters[base];
    if (!adapter) throw new Error(`${this.baseLabel(base)} accounts don't use a sign-in here. Add one with its environment instead.`);
    let availability = this.availability.get(base);
    if (!availability?.ok) {
      await this.ensureMain(base);
      availability = this.availability.get(base);
    }
    if (!availability?.ok) throw new Error(`${this.baseLabel(base)} isn't installed on the daemon machine.`);
    // One flow per provider at a time (Codex's browser sign-in uses a fixed local port).
    for (const login of this.logins.values()) {
      if (login.base === base && !login.finishedAt) await this.cancelLogin(login.id);
    }
    const existing = accountId ? findAccount(await this.store.read(), accountId) : undefined;
    if (accountId && (!existing || existing.base !== base)) throw new Error("That account no longer exists.");

    const id = randomBytes(6).toString("hex");
    const newId = `${base}-${id}`;
    // The home's folder name is the account's provider ID.
    const home = existing ? existing.home : join(homesDir(), newId);
    const session: LoginSession = {
      id,
      base,
      accountId: existing?.id ?? null,
      home,
      handle: null,
      finishedAt: null,
      view: {
        id,
        base,
        method,
        accountId: existing?.id ?? null,
        step: "starting",
        url: null,
        codeUrl: null,
        userCode: null,
        message: null,
        startedAt: new Date().toISOString(),
      },
    };
    this.logins.set(id, session);
    try {
      if (home) await adapter.prepareHome(home);
      const handle = await adapter.login(home, method);
      if (session.finishedAt) {
        handle.cancel();
        return session.view;
      }
      session.handle = handle;
      const sync = () => {
        if (!session.finishedAt) session.view = { ...session.view, ...handle.progress };
      };
      handle.onProgress(sync);
      sync();
      void handle.finished
        .then((result) => this.finishLogin(session, newId, result))
        .catch((error: unknown) => this.failLogin(session, describe(error)));
    } catch (error) {
      this.failLogin(session, describe(error));
    }
    return session.view;
  }

  async submitCode(loginId: string, code: string): Promise<LoginView> {
    const session = this.logins.get(loginId);
    if (!session?.handle) throw new Error("This sign-in has expired. Start again.");
    if (!session.finishedAt) await session.handle.submitCode(code);
    return session.view;
  }

  async cancelLogin(loginId: string): Promise<LoginView | null> {
    const session = this.logins.get(loginId);
    if (!session) return null;
    if (!session.finishedAt) {
      session.finishedAt = Date.now();
      session.handle?.cancel();
      session.view = { ...session.view, step: "canceled", message: "Sign-in was canceled." };
      this.scheduleDiscard(session);
    }
    return session.view;
  }

  private async finishLogin(session: LoginSession, newId: string, result: { ok: boolean; message: string | null }): Promise<void> {
    if (session.finishedAt) return;
    if (!result.ok) return this.failLogin(session, result.message ?? "Sign-in did not finish.");
    session.view = { ...session.view, step: "verifying", message: null };
    const adapter = this.adapters[session.base];
    if (!adapter) return this.failLogin(session, "This provider has no sign-in here.");
    const identity = await adapter.identity(session.home).catch(() => null);
    if (session.finishedAt) return; // Canceled while verifying.
    if (!identity?.signedIn) return this.failLogin(session, "Sign-in finished, but the account isn't signed in. Try again.");

    const state = await this.store.read();
    const existing = findAccount(state, session.accountId);
    if (existing?.kind === "managed" && existing.identity && identity.identity && existing.identity !== identity.identity) {
      // Signing an account back in must not quietly turn it into a different login.
      const expected = existing.email ?? existing.label;
      return this.failLogin(
        session,
        `You signed in as ${identity.email ?? "a different account"}, but this is ${expected}. Sign in as ${expected}, or use Add account for the other one.`,
      );
    }
    // The CLI's own login is whatever the user signs it into; only added accounts must be distinct.
    const duplicate =
      identity.identity && existing?.kind !== "main"
        ? accountsOf(state, session.base).find((account) => account.id !== session.accountId && account.identity === identity.identity)
        : undefined;
    if (duplicate) {
      return this.failLogin(session, `${identity.email ?? "That account"} is already added as "${duplicate.label}". Sign in with a different account.`);
    }
    if (session.finishedAt) return;
    session.finishedAt = Date.now(); // Claim completion before writing, so a late cancel can't race it.

    let accountId = session.accountId;
    let created: StoredAccount | null = null;
    await this.store.update((draft) => {
      let account = findAccount(draft, accountId);
      if (!account) {
        accountId = newId;
        account = newAccount({ id: newId, base: session.base, kind: "managed", home: session.home, envOnly: false });
        draft.accounts.push(account);
        created = account;
      }
      applyIdentity(account, identity);
      if (!account.label) account.label = suggestLabel(account, draft, this.baseLabel(session.base));
    });
    const account = findAccount(await this.store.read(), accountId);
    if (created && account && this.paseo) {
      try {
        const env = providerEnv(await adapter.env(account.home));
        await this.publish(this.paseo, account, accountProviderEntry({ base: account.base, baseLabel: this.baseLabel(account.base), label: account.label, env }));
      } catch (error) {
        // Without its provider the account is unusable, so don't leave a signed-in home behind.
        await this.store.update((draft) => {
          draft.accounts = draft.accounts.filter((entry) => entry.id !== newId);
        });
        session.finishedAt = Date.now();
        session.view = { ...session.view, step: "failed", message: `Signed in, but Paseo wouldn't add the provider: ${describe(error)}` };
        if (session.home) void this.discardHome(session.base, session.home);
        return;
      }
    }
    if (accountId) this.identityCheckedAt.set(accountId, Date.now());
    session.accountId = accountId;
    session.view = { ...session.view, step: "done", accountId, message: null };
    if (accountId) void this.refreshUsage(accountId, true).catch(() => undefined);
  }

  private failLogin(session: LoginSession, message: string): void {
    if (session.finishedAt) return;
    session.finishedAt = Date.now();
    session.handle?.cancel();
    session.view = { ...session.view, step: "failed", message };
    this.scheduleDiscard(session);
  }

  /** A sign-in that ended without an account leaves a half-made home; delete it once the CLI has let go. */
  private scheduleDiscard(session: LoginSession): void {
    if (session.accountId || !session.home) return;
    const { base, home } = session;
    setTimeout(() => void this.discardHome(base, home), LOGIN_GRACE_MS).unref?.();
  }
}

// -------------------------------------------------------------------- helpers

function newAccount(fields: Pick<StoredAccount, "id" | "base" | "kind" | "home" | "envOnly">): StoredAccount {
  return {
    ...fields,
    label: "",
    autoLabel: true,
    email: null,
    plan: null,
    organization: null,
    identity: null,
    signedIn: true,
    createdAt: new Date().toISOString(),
  };
}

function applyIdentity(account: StoredAccount, identity: Identity): void {
  account.signedIn = identity.signedIn;
  if (!identity.signedIn) return;
  account.email = identity.email ?? account.email;
  account.plan = identity.plan ?? account.plan;
  account.organization = identity.organization ?? account.organization;
  account.identity = identity.identity ?? account.identity;
}

/** "work" for work@acme.com, or the full address when another account would read the same. */
export function suggestLabel(account: StoredAccount, state: StoredState, baseLabel: string): string {
  const others = accountsOf(state, account.base).filter((entry) => entry.id !== account.id);
  if (account.email) {
    const local = account.email.split("@")[0] ?? account.email;
    const clash = others.some(
      (entry) => entry.label.toLowerCase() === local.toLowerCase() || entry.email?.split("@")[0]?.toLowerCase() === local.toLowerCase(),
    );
    return clash ? account.email : local;
  }
  let index = others.length + 1;
  while (others.some((entry) => entry.label === `${baseLabel} ${index}`)) index += 1;
  return `${baseLabel} ${index}`;
}

function log(message: string, error: unknown): void {
  console.error(`[paseo-accounts] ${message}`, describe(error));
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

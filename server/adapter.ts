import type { LoginMethod, LoginStep, Usage } from "../shared/model";

export interface Identity {
  signedIn: boolean;
  email: string | null;
  plan: string | null;
  organization: string | null;
  /** Stable key for spotting the same account twice (org + email, or the ChatGPT account ID). */
  identity: string | null;
}

/** A usage reading, plus when to ask again if the provider said to slow down. */
export type UsageRead = Usage & { retryAt?: number };

export interface LoginProgress {
  step: LoginStep;
  /** Link that finishes by itself when opened on the daemon machine (localhost callback), or the device-code page. */
  url: string | null;
  /** Link whose page shows a code to paste back — works from any device. */
  codeUrl: string | null;
  userCode: string | null;
  message: string | null;
}

export interface LoginHandle {
  readonly progress: LoginProgress;
  onProgress(listener: (progress: LoginProgress) => void): void;
  submitCode(code: string): Promise<void>;
  cancel(): void;
  /** Settles when the flow ends. */
  readonly finished: Promise<{ ok: boolean; message: string | null }>;
}

/**
 * Environment changes for a process run against an account. `null` means "inherit the daemon's
 * value": the key is left out of the account's provider env, and untouched for processes Paseo Accounts spawns.
 */
export type EnvPatch = Record<string, string | null>;

/**
 * What Paseo Accounts adds on top of a Paseo provider that has no support of its own: an isolated
 * credential home, sign-in, and usage. Paseo already runs the agent and lists its models, so a
 * provider with no adapter still gets accounts — just env-only ones.
 */
export interface ProviderAdapter {
  /** The Paseo provider this adapter belongs to. */
  readonly base: string;
  /** Shortest gap between usage checks for one account, even when a refresh is forced. */
  readonly usageSpacingMs: number;
  available(): Promise<{ ok: boolean; detail: string | null }>;
  /** Creates or refreshes a managed home: isolated credentials, everything else shared with main. */
  prepareHome(home: string): Promise<void>;
  /** `home === null` is the CLI's own login. */
  env(home: string | null): Promise<EnvPatch>;
  identity(home: string | null): Promise<Identity>;
  /**
   * Usage windows. `renewLogin` lets the adapter have the CLI refresh an expired sign-in first
   * (slow, so only for explicit requests, never background polls).
   */
  usage(home: string | null, options?: { renewLogin?: boolean }): Promise<UsageRead>;
  login(home: string | null, method: LoginMethod): Promise<LoginHandle>;
  logout(home: string): Promise<void>;
}

/** The environment for a process Paseo Accounts spawns against `patch`. */
export function spawnEnv(patch: EnvPatch): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(patch)) if (value !== null) env[key] = value;
  return env;
}

/** The variables a Paseo provider entry sets for an account's sessions. */
export function providerEnv(patch: EnvPatch): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) if (value !== null) env[key] = value;
  return env;
}

/** Shared helper for login handles: progress state plus listeners. */
export class ProgressEmitter {
  progress: LoginProgress = { step: "starting", url: null, codeUrl: null, userCode: null, message: null };
  private readonly listeners = new Set<(progress: LoginProgress) => void>();

  onProgress(listener: (progress: LoginProgress) => void): void {
    this.listeners.add(listener);
  }

  update(patch: Partial<LoginProgress>): void {
    this.progress = { ...this.progress, ...patch };
    for (const listener of this.listeners) listener(this.progress);
  }
}

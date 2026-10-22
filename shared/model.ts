import { z } from "zod";


export const UsageWindowSchema = z.object({
  /** Stable key, e.g. `five_hour`, `seven_day`, `seven_day_opus`, `primary`, `secondary`. */
  id: z.string(),
  label: z.string(),
  /** 0–100. */
  usedPercent: z.number(),
  resetsAt: z.string().nullable(),
});
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

export const UsageSchema = z.object({
  fetchedAt: z.string(),
  windows: z.array(UsageWindowSchema),
  /** Why usage could not be read, if it could not. Old windows may still be shown. */
  error: z.string().nullable(),
  /** Read from the CLI's own cache rather than the provider, so possibly out of date. */
  cached: z.boolean().default(false),
});
export type Usage = z.infer<typeof UsageSchema>;

export const AccountKindSchema = z.enum([
  /** The base provider's own login (`~/.claude`, `~/.codex`, …): the provider Paseo ships. */
  "main",
  /** Added by this plugin: its own provider entry in Paseo's config, extending the base provider. */
  "managed",
]);
export type AccountKind = z.infer<typeof AccountKindSchema>;

export const AccountStatusSchema = z.enum([
  "ready",
  "signed_out",
  /** Still has a stored sign-in, but the provider rejects it and the CLI couldn't renew it. */
  "expired",
  "limited",
  "checking",
]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const AccountViewSchema = z.object({
  /** The Paseo provider ID of this account: the base provider's own ID for `main`. */
  id: z.string(),
  /** The built-in provider this account extends, e.g. `claude`. */
  base: z.string(),
  label: z.string(),
  kind: AccountKindSchema,
  email: z.string().nullable(),
  plan: z.string().nullable(),
  organization: z.string().nullable(),
  status: AccountStatusSchema,
  /** The provider has sign-in and usage support here (Claude, Codex); others are plain env accounts. */
  managedLogin: z.boolean(),
  /** Paseo's own provider switch; a disabled account is hidden from the pickers. */
  enabled: z.boolean(),
  /** A Paseo profile launches agents on this account. */
  hasProfile: z.boolean(),
  usage: UsageSchema.nullable(),
  /** Variable names (not values) the account sets, for providers without managed sign-in. */
  envKeys: z.array(z.string()),
  home: z.string().nullable(),
});
export type AccountView = z.infer<typeof AccountViewSchema>;

/** A built-in Paseo provider that can have extra accounts. */
export const BaseProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Sign-in, usage and an isolated credential home are handled here. Otherwise accounts are env-only. */
  managedLogin: z.boolean(),
});
export type BaseProvider = z.infer<typeof BaseProviderSchema>;

export const LoginStepSchema = z.enum([
  "starting",
  /** Waiting for the user to finish on the sign-in page (and paste a code, if using `codeUrl`). */
  "waiting",
  "verifying",
  "done",
  "failed",
  "canceled",
]);
export type LoginStep = z.infer<typeof LoginStepSchema>;

export const LoginMethodSchema = z.enum([
  /** Finishes by itself when the link is opened on the daemon machine. */
  "browser",
  /** Works from any device: paste a code back (Claude) or type a code on the page (ChatGPT). */
  "code",
]);
export type LoginMethod = z.infer<typeof LoginMethodSchema>;

export const LoginViewSchema = z.object({
  id: z.string(),
  base: z.string(),
  method: LoginMethodSchema,
  /** Set once the account exists (immediately when signing an existing account back in). */
  accountId: z.string().nullable(),
  step: LoginStepSchema,
  /** Link that completes by itself (browser callback) or the device-code page. */
  url: z.string().nullable(),
  /** Link whose page shows a code to paste back; works from any device. */
  codeUrl: z.string().nullable(),
  /** Device code the user types on the sign-in page (ChatGPT device flow). */
  userCode: z.string().nullable(),
  message: z.string().nullable(),
  startedAt: z.string(),
});
export type LoginView = z.infer<typeof LoginViewSchema>;

export const StateViewSchema = z.object({
  accounts: z.array(AccountViewSchema),
  bases: z.array(BaseProviderSchema),
  logins: z.array(LoginViewSchema),
  /**
   * A browser on the daemon's machine can finish a sign-in by itself. False on servers, containers
   * and daemons started over SSH, where only the code sign-in works.
   */
  browserSignIn: z.boolean().default(true),
  warnings: z.array(z.string()),
});
export type StateView = z.infer<typeof StateViewSchema>;

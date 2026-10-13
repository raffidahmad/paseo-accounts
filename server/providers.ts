import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { AccountView, BaseProvider } from "../shared/model";

type PaseoApi = PluginHandlerContext["paseo"];

/** A Paseo `agentProfiles` entry, as far as this plugin cares. */
export interface Profile {
  id: string;
  name: string;
  provider: string;
  [key: string]: unknown;
}

/** What an account looks like in Paseo's `providers` config: a built-in provider with its own environment. */
export interface ProviderEntry {
  extends: string;
  label: string;
  description?: string;
  env: Record<string, string>;
}

/** Marks profiles this plugin made, so it only ever removes its own. */
export const PROFILE_NOTE = "Added by Paseo Accounts.";

/** The provider ID of an added account: the base ID plus the account's short ID, never a built-in's. */
export function accountProviderId(base: string, shortId: string): string {
  return `${base}-${shortId}`;
}

/** "Claude · work": how an account reads in Paseo's provider list and pickers. */
export function providerLabel(baseLabel: string, accountLabel: string): string {
  return `${baseLabel} · ${accountLabel}`;
}

export function accountProviderEntry(input: {
  base: string;
  baseLabel: string;
  label: string;
  env: Record<string, string>;
}): ProviderEntry {
  return {
    extends: input.base,
    label: providerLabel(input.baseLabel, input.label),
    description: `${input.baseLabel} on the "${input.label}" account`,
    env: input.env,
  };
}

/**
 * Built-in providers that can have extra accounts. Providers Paseo reports as custom are skipped:
 * they are accounts (or the user's own profiles), not something to extend again.
 */
export function listBaseProviders(
  entries: ReadonlyArray<{ provider: string; source?: string; label?: string }>,
  managed: ReadonlySet<string>,
  hasAdapter: (provider: string) => boolean,
): BaseProvider[] {
  return entries
    .filter((entry) => entry.source !== "custom" && !managed.has(entry.provider))
    .map((entry) => ({ id: entry.provider, label: entry.label?.trim() || entry.provider, managedLogin: hasAdapter(entry.provider) }));
}

export function profileId(providerId: string): string {
  return `paseo-accounts-${providerId}`;
}

/** Adds the account's profile unless one for that provider already exists (including the user's own). */
export function withProfile(profiles: readonly Profile[], providerId: string, name: string): Profile[] {
  if (profiles.some((profile) => profile.provider === providerId)) return [...profiles];
  return [...profiles, { id: profileId(providerId), name, provider: providerId, notes: PROFILE_NOTE }];
}

/** Drops every profile that launches on the provider: the account is gone, so they could not start. */
export function withoutProfiles(profiles: readonly Profile[], providerId: string): Profile[] {
  return profiles.filter((profile) => profile.provider !== providerId);
}

/** Renames this plugin's profile for the account, unless the user already renamed it themselves. */
export function renameProfile(profiles: readonly Profile[], providerId: string, from: string, to: string): Profile[] {
  return profiles.map((profile) =>
    profile.id === profileId(providerId) && profile.name === from ? { ...profile, name: to } : profile,
  );
}

export function hasProfile(profiles: readonly Profile[], providerId: string): boolean {
  return profiles.some((profile) => profile.provider === providerId);
}

function asProfiles(value: unknown): Profile[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Profile =>
      Boolean(entry) && typeof entry === "object" && typeof (entry as Profile).id === "string" && typeof (entry as Profile).provider === "string",
  );
}

/** Reads and writes the parts of the daemon config that hold accounts and their profiles. */
export class ConfigSync {
  async read(paseo: PaseoApi): Promise<{ providers: Record<string, Record<string, unknown>>; profiles: Profile[] }> {
    const { config } = await paseo.config.get();
    const providers = (config.providers ?? {}) as Record<string, Record<string, unknown>>;
    return { providers, profiles: asProfiles((config as { agentProfiles?: unknown }).agentProfiles) };
  }

  /** Creates or replaces an account's provider entry, leaving the user's own edits to `enabled` and `order` alone. */
  async upsertProvider(paseo: PaseoApi, id: string, entry: ProviderEntry): Promise<void> {
    await paseo.config.patch({ providers: { [id]: entry } } as unknown as Parameters<PaseoApi["config"]["patch"]>[0]);
  }

  async removeProvider(paseo: PaseoApi, id: string): Promise<void> {
    await paseo.config.patch({ removeProviders: [id] });
  }

  /** `agentProfiles` is replaced as a whole, so every change reads the current list first. */
  async editProfiles(paseo: PaseoApi, change: (profiles: Profile[]) => Profile[]): Promise<void> {
    const { profiles } = await this.read(paseo);
    const next = change(profiles);
    if (JSON.stringify(next) === JSON.stringify(profiles)) return;
    await paseo.config.patch({ agentProfiles: next } as unknown as Parameters<PaseoApi["config"]["patch"]>[0]);
  }
}

/** The account view fields that come from Paseo's config rather than the plugin's registry. */
export function configFacts(
  accountId: string,
  providers: Record<string, Record<string, unknown>>,
  profiles: readonly Profile[],
): Pick<AccountView, "enabled" | "hasProfile" | "envKeys"> {
  const entry = providers[accountId];
  const env = entry?.env && typeof entry.env === "object" ? Object.keys(entry.env as Record<string, unknown>) : [];
  return { enabled: entry?.enabled !== false, hasProfile: hasProfile(profiles, accountId), envKeys: env };
}

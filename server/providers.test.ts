import { describe, expect, it } from "vitest";
import {
  accountProviderEntry,
  accountProviderId,
  configFacts,
  listBaseProviders,
  renameProfile,
  withProfile,
  withoutProfiles,
  type Profile,
} from "./providers";

describe("account providers", () => {
  it("extends the base provider with its own environment", () => {
    expect(accountProviderId("claude", "ab12")).toBe("claude-ab12");
    expect(accountProviderEntry({ base: "claude", baseLabel: "Claude", label: "work", env: { CLAUDE_CONFIG_DIR: "/h" } })).toEqual({
      extends: "claude",
      label: "Claude · work",
      description: 'Claude on the "work" account',
      env: { CLAUDE_CONFIG_DIR: "/h" },
    });
  });

  it("lists built-in providers as bases and leaves accounts and custom ones out", () => {
    const bases = listBaseProviders(
      [
        { provider: "claude", source: "builtin", label: "Claude" },
        { provider: "pi", source: "builtin", label: "Pi" },
        { provider: "claude-ab12", source: "custom", label: "Claude · work" },
        { provider: "mine", source: "custom" },
      ],
      new Set(["claude-ab12"]),
      (id) => id === "claude",
    );
    expect(bases).toEqual([
      { id: "claude", label: "Claude", managedLogin: true },
      { id: "pi", label: "Pi", managedLogin: false },
    ]);
  });
});

describe("profiles", () => {
  const mine: Profile = { id: "p1", name: "review", provider: "claude", model: "sonnet" };

  it("adds one profile per account and never duplicates", () => {
    const added = withProfile([mine], "claude-ab12", "Claude · work");
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({ id: "paseo-accounts-claude-ab12", name: "Claude · work", provider: "claude-ab12" });
    expect(withProfile(added, "claude-ab12", "Other")).toHaveLength(2);
  });

  it("removes every profile of a removed account and nothing else", () => {
    const profiles = withProfile([mine, { id: "p2", name: "fast", provider: "claude-ab12" }], "claude-ab12", "x");
    expect(withoutProfiles(profiles, "claude-ab12")).toEqual([mine]);
  });

  it("renames only a profile the user hasn't renamed", () => {
    const profiles = withProfile([], "claude-ab12", "Claude · work");
    expect(renameProfile(profiles, "claude-ab12", "Claude · work", "Claude · job")[0]?.name).toBe("Claude · job");
    const edited = [{ ...profiles[0]!, name: "My work profile" }];
    expect(renameProfile(edited, "claude-ab12", "Claude · work", "Claude · job")[0]?.name).toBe("My work profile");
  });
});

describe("configFacts", () => {
  it("reads enablement and variable names from Paseo's config", () => {
    const providers = { "pi-1": { extends: "pi", enabled: false, env: { PI_KEY: "secret" } } };
    expect(configFacts("pi-1", providers, [])).toEqual({ enabled: false, hasProfile: false, envKeys: ["PI_KEY"] });
    expect(configFacts("pi-2", providers, [])).toEqual({ enabled: true, hasProfile: false, envKeys: [] });
  });
});

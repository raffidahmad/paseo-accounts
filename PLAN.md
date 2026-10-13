# Rework ZeroSub: accounts become native Paseo providers (+ per-account profiles)

> Tracking file. GitHub issue creation was refused (403, the integration lacks Issues permission), so this file on branch `feat/accounts-as-providers` is the source of truth. Tick boxes as work lands, note commit SHAs, push after every update. **Delete this file in the final commit once everything is done** (or move its content into an issue).

## Goal

ZeroSub supported multiple accounts for **Claude and Codex only**, routing every agent to an account through a `before("agent.session_open")` hook, with failover, bindings, balancing, forks, banked resets and a composer pill. Rework it so that:

1. **Each account is a native Paseo provider** (`providers.<id> = { extends: <base>, label, env }` in the daemon config, written with `paseo.config.patch`). It works for *any* built-in provider Paseo reports, so new Paseo providers become addable automatically.
2. **Each account gets a Paseo profile** (`agentProfiles` entry with `provider: <account id>`), created when the account is added and removed when it is removed.
3. **Model selection per account** comes for free: every account appears in Paseo's own provider / model picker, since it is a provider.

The plugin gets much smaller and generic.

## Decisions (agreed with the user, do not relitigate)

- **Remove** failover, per-agent account switching (composer pill, `/account`, ⌘K commands), default account, balancing, auto-continue, forking to the other provider, the switch timeline row, **banked resets** (manual and automatic), and ZeroSub's own enable/disable (Paseo's provider `enabled` flag replaces it). Failover is meant to be a separate plugin.
- **Keep**: add / sign in again / rename / remove accounts, in-app sign-in (Claude `claude auth login`, Codex app-server), per-account usage bars, identity (email/plan), shared-home overlay (`server/homes.ts`), multi-host behaviour, the Accounts sidebar surface.
- **Generic providers**: only Claude and Codex have adapters (`ProviderAdapter`: isolated home, env, identity, usage, login/logout). Any other built-in provider gets **env-only accounts**: a label plus user-entered `KEY=VALUE` env vars (API key, config dir, …), stored in Paseo's provider config only (never duplicate secrets into ZeroSub's state).
- **Clean break, no migration.** New registry file `$PASEO_HOME/zerosub/accounts.json` (v2). The old `state.json` and old homes under `$PASEO_HOME/zerosub/homes/` are left untouched and never auto-deleted; the README tells users how to remove them.
- Preferences collapse to one setting: `createProfiles` (default true); `version: 2` with `migrate: () => ({})`.

## Key API facts (verified in `node_modules/@getpaseo/*` 0.9.1)

- `paseo.config.get()` / `paseo.config.patch()` expose daemon config. Patch accepts `providers` (record, loose objects so `extends`/`label`/`env` pass through), `removeProviders: string[]`, and `agentProfiles` (**array; replaces the whole array**, so read-modify-write).
- `ProviderOverrideSchema` (protocol `provider-config.d.ts`): `extends`, `label`, `description`, `command`, `env`, `models`, `additionalModels`, `enabled`, `order`, …
- `AgentProfile`: `{ id, name, icon?, color?, provider, model?, modeId?, thinkingOptionId?, featureValues?, notes? }`.
- `paseo.providers.snapshot()` returns entries `{ provider, status, enabled, source: "builtin"|"custom", label, error, models }`: use it to list base providers (`source === "builtin"`).
- `before("agent.session_open")` request has `provider` and `env`. Keep one tiny hook that refreshes the shared-home overlay (`adapter.prepareHome(home)`) when `request.provider` is a managed account; return `undefined` (the env lives in the provider config).
- **Not verifiable offline**: that a live daemon accepts `extends` + `env` through `config.patch` and honours them for model discovery and sessions. Typecheck and unit test only; call this out to the user.

## Architecture

- `server/providers.ts` (new): pure helpers + thin `ConfigSync` over `paseo.config`: `accountProviderEntry(base, label, env)`, `providerId(base, shortId)` (`<base>-<id>`, never collides with built-ins), `listBaseProviders(snapshot)`, `upsertProvider`, `removeProvider`, `ensureProfile`, `removeProfiles(providerId)`, `renameProfile`. Reconcile on start: every stored account must have its provider entry (re-create if config was reset).
- `server/service.ts` (rewrite, target < 500 lines): start/tick (usage polling, identity refresh), `view()`, add/sign-in/cancel login (reuse `beginLogin/finishLogin` logic with `base` instead of `family`), `addEnvAccount`, `rename`, `remove` (logout, `removeHome`, `removeProviders`, remove profiles), `setProfile`, `onSessionOpen` (overlay refresh only). Main accounts (`id === base`, kind `main`) keep identity/usage for the CLI login.
- Account `status`: `signed_out`, `limited` (any usage window ≥ 100%), `ready`, `checking`.

## Todo

### Done
- [x] Delete removed code: `server/{routing,handoff,reopen,switch-guard,modes,limits,claude-resets,families}.ts`, their tests, `shared/timeline.ts`, `client/{commands,pills,fork-confirm,reset-confirm,switch-row}`
- [x] `shared/model.ts`: `family` → `base: string`; `ResetOffer` removed; `AccountView` (`id`=provider id, `managedLogin`, `enabled`, `hasProfile`, `envKeys`), `BaseProvider`, new `StateView` (`accounts`, `bases`, `logins`, `browserSignIn`, `warnings`)
- [x] `shared/rpc.ts`: `getState`, `startLogin{base,…}`, `submitLoginCode`, `cancelLogin`, `addEnvAccount`, `renameAccount`, `removeAccount`, `setAccountProfile`
- [x] `shared/preferences.ts`: only `createProfiles` (v2, `migrate`)
- [x] `server/adapter.ts` → `ProviderAdapter` (+ `providerEnv()`); `claude.ts` / `codex.ts` stripped of limit detection and resets (Claude usage no longer requests `cedar_ember`)
- [x] `server/state.ts` → `accounts.json` v2 (`base`, `envOnly`, no bindings/defaults/sessions); `state.test.ts` updated
- [x] `server/binaries.ts` `providerCommand(provider: string)`

### Remaining
- [ ] `server/usage.ts`: drop `showLimit` (+ its tests); `usage.test.ts`: remove `SwitchGuard` block and `resets` field
- [ ] `server/providers.ts` + `server/providers.test.ts` (entry shape, id generation, base listing, profile add/remove/rename, reconcile)
- [ ] `server/service.ts` rewrite per Architecture
- [ ] `server/homes.ts`: nothing may delete homes except explicit remove / failed or cancelled login (the old orphan collector is gone); `homes.test.ts` still passes
- [ ] `index.server.ts`: adapters `{claude, codex}`, handlers for the new RPCs, session-open overlay hook, `agent.turn_ended` → usage refresh for managed accounts; remove old handlers/hooks
- [ ] Client: `client/store.ts`, `client/accounts-surface.tsx` (one section per base provider from `state.bases`; account cards with usage, rename, remove, profile toggle, Paseo-disabled badge; no default/switch/reset UI), `client/add-account.tsx` (managed-login flow for adapter bases + env-account form for others), `client/settings-screen.tsx` (just `createProfiles`), `client/ui.tsx` cleanup, `index.client.tsx` (drop pills, commands, timeline renderer)
- [ ] `shared/format.ts`: drop `shortLabel` and removed statuses in `usageSummary`; fix `format.test.ts`
- [ ] `server/parsers.test.ts`: remove hand-off tests
- [ ] `README.md`: rewrite Use / How it works / Limitations for the provider model; document the clean break and how to delete old `state.json` + `homes/`; env accounts for non-Claude/Codex providers
- [ ] `package.json` description/keywords, version `2.0.0`; `paseo-plugin.json` if needed
- [ ] `npm run typecheck`, `npm test`, `npm run audit:mobile` all green
- [ ] Delete `PLAN.md`, commit, push to `feat/accounts-as-providers` (**no PR unless asked**)

## Resuming (for another agent)

1. `git fetch origin feat/accounts-as-providers && git checkout feat/accounts-as-providers`; `npm install` (don't commit `package-lock.json` churn).
2. This checklist is the source of truth: update and push it after each finished item.
3. Verify with `npm run typecheck && npm test && npm run audit:mobile`.
4. Client code must stay React Native only (`audit:mobile` rejects DOM/HTML).
5. Do not reintroduce routing/failover/resets: intentionally removed.

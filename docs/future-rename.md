# Rename the plugin and credit ZeroSub as its origin (future issue)

Future work. Issues are disabled on this repo, so it is kept here; turn it into an issue if Issues get enabled.

## Context
After the "accounts as native Paseo providers" rework the plugin is generic and no longer switches accounts, so "ZeroSub" no longer describes it.

## Todo
- [ ] Pick a name: `paseo-accounts` (recommended), `paseo-multi-account`, `paseo-multi-provider-sub` (long, "sub" is ambiguous), `paseo-seats`.
- [ ] Rename together with the 2.0 clean break. Places that carry the name: npm package `@kapybara/zerosub`, plugin id in `paseo-plugin.json`, RPC names `zerosub.*`, settings id, data dir `$PASEO_HOME/zerosub`, sidebar title, log prefix `[ZeroSub]`, repo/homepage URLs in `package.json`.
- [ ] `npm deprecate` the old package with a pointer to the new one; rename the GitHub repo (keeps redirects) instead of creating a new one.
- [ ] README: add an "Origin" section: grew out of ZeroSub (link the original repo and releases) and what changed.
- [ ] LICENSE: keep the MIT text and original copyright line unchanged; only add a line for new contributions, never replace the original.
- [ ] Decide whether the new plugin should offer to clean up leftover `$PASEO_HOME/zerosub` homes (the 2.0 plan does not migrate or delete them).
- [ ] Check whether the original authors (`@kapybara`, "Kapybara") need to agree to the rename.

Do this after the provider rework lands, as its own change.

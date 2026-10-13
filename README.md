# Paseo Accounts

Add more accounts to any provider in [Paseo](https://paseo.sh): a second Claude subscription, a ChatGPT (Codex) workspace, or another provider with its own key. Each account becomes a **native Paseo provider**, so everything Paseo already does with providers works with it.

- **Accounts are providers.** An account shows up in Paseo's provider list and model picker (for example *Claude · work*), with its own models. Pick it when you start a chat.
- **A profile per account.** Adding an account also adds a Paseo profile for it, so a chat on that account, with the model you like, is one tap away. Turn that off in the preferences, or add and remove a profile per account.
- **Works for any provider.** Every built-in provider Paseo reports can get extra accounts, including ones Paseo adds later. Claude and ChatGPT (Codex) accounts sign in inside the app; other providers get accounts with their own environment variables, such as an API key.
- **Sign in anywhere.** Click **Add account**, **Open sign-in page** and sign in on any device, including your phone. No terminal, environment variables or config files.
- **Live usage.** Claude and ChatGPT accounts show their 5-hour and weekly usage and when it resets.
- **Everything else stays the same.** Added Claude and ChatGPT accounts share your settings, skills, plugins, MCP servers, `CLAUDE.md`/`AGENTS.md` and conversation history.
- **Several hosts.** Each Paseo host keeps its own accounts.

This plugin no longer moves agents between accounts when one hits a limit; an agent stays on the account (provider) it started with. That kind of failover is better as a separate plugin.

## Install

Requirements:

- Paseo 0.9.1 or later, with plugins enabled (**Settings → Plugins → Enable plugins**).
- For Claude and ChatGPT accounts: the `claude` and/or `codex` CLI installed where the daemon runs, the same ones Paseo already uses.

In the app, open **Settings → Plugins**, paste `npm:@raffidahmad/paseo-accounts` as the plugin source, and install. Or, on the daemon host:

```bash
paseo plugin install npm:@raffidahmad/paseo-accounts
# or straight from GitHub:
paseo plugin install github:raffidahmad/paseo-accounts
```

Then open **Accounts** in the sidebar.

## Use it

1. Open **Accounts**. Each built-in provider has a section; your own CLI login is listed for Claude and ChatGPT.
2. Click **Add account** in a provider's section.
   - **Claude or ChatGPT:** click **Open sign-in page** and sign in with the other account. In a browser on the host's own computer the page finishes by itself. Anywhere else, choose **Use a code instead**: for Claude paste the code shown after sign-in, for ChatGPT type the code shown in Paseo on the page. Phones, and hosts without a desktop (servers, containers, daemons started over SSH), start with the code.
   - **Any other provider:** give the account a name and the environment variables it should run with (`KEY=value`, one per line), for example an API key or a separate config folder.
3. Start a chat and pick the account like any provider, or pick its profile under **Profiles** in the model picker. Paseo's **Settings → Providers** lists every account too, where you can switch one off.
4. **Rename**, **Remove**, or **Add/Remove profile** from the account's card. Removing an account deletes its provider and profiles, and signs Claude and ChatGPT accounts out.

Agents already running on a removed account stop working; archive them first. Their conversations are kept.

## How it works

An account is an entry in Paseo's provider config that extends the built-in provider:

```json
"claude-4f2a9c1d": {
  "extends": "claude",
  "label": "Claude · work",
  "env": { "CLAUDE_CONFIG_DIR": "…/paseo-accounts/homes/claude-4f2a9c1d" }
}
```

Paseo Accounts writes that entry (and the matching `agentProfiles` entry) through Paseo's config API, so Paseo runs the agent, lists the models and shows the provider like any other. Paseo Accounts only adds what Paseo can't: a separate credential home, the sign-in flow, and usage.

For Claude and ChatGPT, each added account gets its own credential home under `$PASEO_HOME/paseo-accounts/homes/`:

- Claude uses it as `CLAUDE_CONFIG_DIR`; Codex uses it as `CODEX_HOME`.
- The CLIs keep each home's login separate: Claude in its own keychain entry (`.credentials.json` on Linux), Codex in its own `auth.json`.
- Everything that isn't account-specific is a symlink back to `~/.claude` or `~/.codex`. For Claude that includes `settings.json`, `skills/`, `plugins/` and `projects/`; for Codex, `config.toml`, `sessions/` and more. Codex also shares its thread database through `CODEX_SQLITE_HOME`.
- Claude's `.claude.json` holds the account identity, so each account keeps its own copy. It's seeded from yours, and your MCP servers stay in sync.

A `before("agent.session_open")` hook refreshes those links when a session opens. Sign-in runs the official CLIs: `claude auth login` and `codex app-server`'s account API. Paseo Accounts never implements OAuth itself and never copies credentials between accounts.

## Several hosts

Paseo installs plugins per host (daemon), so install Paseo Accounts on each host that should use it. When more than one host has it, Paseo shows a single **Accounts** item with a host picker at the top.

- **Each host has its own accounts and preferences**, because the sign-ins live on the machine where the agents run.
- **Sign the same account in on each host.** Paseo Accounts never copies sign-ins between hosts. Both providers rotate sign-in tokens, so two machines sharing one token sign each other out. Separate sign-ins of the same account work fine.
- **Remote hosts:** phones, and hosts without a desktop, get the code sign-in automatically.

## Privacy and security

- Credentials stay in the CLIs' own stores. The plugin's registry (`$PASEO_HOME/paseo-accounts/accounts.json`) holds only account names, emails and plans. Environment variables for other providers live in Paseo's provider config, never in the registry.
- To show Claude usage, Paseo Accounts reads each account's current access token and calls Anthropic's usage endpoint, the same way Paseo's built-in usage display and `/usage` do. It never logs or stores tokens and never refreshes them itself. When you refresh usage (the ↻ button) and a token has expired, it runs `claude -p /usage` so Claude Code renews its own sign-in. Codex usage comes from `codex app-server`.
- Removing an account deletes its provider and profiles, signs it out (`claude auth logout` / Codex logout) and deletes its home. A sign-in you abandon is cleaned up the same way. Your CLI login can't be removed from Paseo Accounts.

## Coming from ZeroSub

Paseo Accounts grew out of [ZeroSub](https://github.com/kapybara-org/zerosub), and the two are independent plugins: different plugin id (`paseo-accounts`), data folder and storage, so they can be installed side by side. ZeroSub 1.x keeps working for anyone who wants its per-agent switching, automatic failover and banked resets; Paseo Accounts doesn't have those. An agent here stays on the account (provider) it started with.

Paseo Accounts doesn't read ZeroSub's accounts, so add yours again here. If you switch for good, nothing is deleted for you. Remove ZeroSub when you no longer need it, after signing its accounts out in its own Accounts screen:

```bash
paseo plugin remove zerosub
rm -rf ~/.paseo/zerosub
```

Its added accounts stay signed in until you remove them there or delete that folder.

## Limitations

- **MCP servers that use OAuth** (Linear, Notion, …) store their tokens per Claude account, so sign in to them once on each account.
- **Shared settings apply to every account.** If `~/.claude/settings.json` sets an `apiKeyHelper` or API-key `env`, every account uses that key instead of its subscription.
- **Usage for an idle Claude account** shows the last reading until the account is used again or you refresh usage. Anthropic rate-limits its usage endpoint, so a reading can be a few minutes old. Readings are saved in `$PASEO_HOME/paseo-accounts/usage.json`.
- **Other providers** have no sign-in or usage here: an account is a name plus the environment you give it.
- **ChatGPT device-code sign-in** has to be enabled in ChatGPT → Settings → Security. The browser option works from a browser on the host's own computer.
- Written against Paseo 0.9.1's plugin and config APIs. Tested on macOS with Claude Code 2.1.280 and Codex 0.156.1 before the 2.0 rework; the 2.0 provider entries haven't been run against a live daemon yet. Linux should work. Windows is untested.

## Development

```bash
git clone https://github.com/raffidahmad/paseo-accounts.git
cd paseo-accounts
npm install
paseo plugin install "$(pwd)"   # run the working copy

npm run typecheck      # client and server bundles, separately
npm test               # providers, account homes, usage, state
npm run audit:mobile   # no DOM/HTML in client code
paseo plugin reload paseo-accounts
paseo plugin logs paseo-accounts
```

Code layout:

- `index.server.ts`, `index.client.tsx`: plugin entry points.
- `client/`: React Native UI (Accounts surface, sign-in and environment modals).
- `server/`: the service, provider and profile config sync, account homes, Claude and Codex adapters.
- `shared/`: RPC contracts and the view model.

Report problems at [github.com/raffidahmad/paseo-accounts/issues](https://github.com/raffidahmad/paseo-accounts/issues).

## Origin

Paseo Accounts grew out of [ZeroSub](https://github.com/kapybara-org/zerosub) by Kapybara, a plugin for using several Claude and ChatGPT subscriptions in Paseo, and builds on its account homes, sign-in flows and usage readers. It was renamed and reworked so that accounts are native Paseo providers with profiles, and works with any provider. It is MIT licensed, as ZeroSub was: see [LICENSE](LICENSE), which keeps ZeroSub's original copyright notice.

## Uninstall

Remove added accounts from **Accounts** first, so they're signed out and their providers are deleted. Then run:

```bash
paseo plugin remove paseo-accounts
rm -rf ~/.paseo/paseo-accounts
```

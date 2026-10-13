Paseo Accounts lets you add more accounts to any provider in Paseo, such as a second Claude subscription, a ChatGPT (Codex) workspace, or another provider that runs with its own API key. Each account becomes a native Paseo provider, so it appears in the provider list and model picker with its own models. Adding an account also adds a Paseo profile for it, so starting a chat on that account is one tap away. An agent stays on the account it started with; the plugin does not move agents between accounts.

## How it works

An account is an entry in Paseo's provider config that extends the built-in provider. The plugin writes that entry, and the matching profile, through Paseo's config API, so Paseo runs the agent and lists the models itself. The plugin adds only what Paseo does not provide: a separate credential home, the sign-in flow and usage readings. Sign-in runs the official `claude` and `codex` CLIs. The plugin never implements OAuth itself and never copies credentials between accounts.

## Setup

You need Paseo 0.9.1 or later with plugins enabled. For Claude and ChatGPT accounts, the `claude` and `codex` CLIs must be installed where the daemon runs, the same ones Paseo already uses. Linux and macOS are expected to work; Windows is untested. Open Settings, then Plugins, then Paseo Accounts, and choose Add account in a provider's section. For Claude and ChatGPT, open the sign-in page and sign in with the other account. A browser on the host's own computer finishes the sign-in by itself. On a phone, or on a host without a desktop, use the code option instead. For any other provider, enter a name and the environment variables the account should run with, one `KEY=value` per line.

## What it reads, stores and sends

Each added Claude or ChatGPT account gets its own credential home under `$PASEO_HOME/paseo-accounts/homes/`. Claude uses it as `CLAUDE_CONFIG_DIR` and Codex uses it as `CODEX_HOME`. The CLIs keep each login in their own store. Settings, skills, plugins, MCP servers, instruction files and conversation history are symlinked back to your own `~/.claude` or `~/.codex`, so every account shares them. The plugin's registry file holds only account names, emails and plans. Environment variables for other providers live in Paseo's provider config, not in the registry.

To show Claude usage, the plugin reads each account's current access token and calls Anthropic's usage endpoint, the same way Paseo's own usage display does. It does not log, store or refresh tokens. If a token has expired when you refresh usage, it runs `claude -p /usage` so Claude Code renews its own sign-in. Codex usage comes from `codex app-server`. Readings are saved in `$PASEO_HOME/paseo-accounts/usage.json`. Removing an account deletes its provider and profiles, signs it out and deletes its credential home. Your own CLI login cannot be removed from the plugin.

## Limits

Each Paseo host keeps its own accounts and preferences, and sign-ins are never copied between hosts, so sign in on each host. MCP servers that use OAuth store their tokens per Claude account, so sign in to them once on each account. If your shared `~/.claude/settings.json` sets an `apiKeyHelper` or an API-key `env`, every account uses that key instead of its subscription. Usage for an idle Claude account shows the last reading until the account is used or you refresh, and Anthropic rate-limits its usage endpoint, so a reading can be a few minutes old. Other providers have no sign-in or usage in this plugin.

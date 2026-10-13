import type { PluginServerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import { ClaudeAdapter } from "./server/claude";
import { CodexAdapter } from "./server/codex";
import { Service, describe } from "./server/service";
import { preferences } from "./shared/preferences";
import {
  addEnvAccount,
  cancelLogin,
  getState,
  removeAccount,
  renameAccount,
  setAccountProfile,
  startLogin,
  submitLoginCode,
} from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  // Only providers that need more than Paseo already does get an adapter; every other built-in
  // provider can still have env-only accounts.
  const service = new Service({ claude: new ClaudeAdapter(), codex: new CodexAdapter() });

  const settings = server.registerSettings(preferences);
  const applySettings = (state: PluginSettingsState<typeof preferences.schema>) => {
    if (state.status === "ready") service.setPreferences(state.values);
  };
  void settings.read().then(applySettings, (error: unknown) => console.error("[paseo-accounts] could not read preferences", describe(error)));
  const stopSettings = settings.subscribe(applySettings);

  void service.start().catch((error: unknown) => console.error("[paseo-accounts] startup failed", describe(error)));

  // Account providers carry their own environment, so this only refreshes an account's shared files.
  // It must never break or stall a session: Paseo fails a hook after 30s.
  server.before("agent.session_open", async ({ request }, context) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 10_000);
    });
    try {
      await Promise.race([service.onSessionOpen(request, context), deadline]);
    } catch (error) {
      console.error(`[paseo-accounts] could not prepare ${request.provider} for ${request.agentId}`, describe(error));
    } finally {
      clearTimeout(timer);
    }
    return undefined;
  });

  server.on("agent.turn_ended", (event, context) => {
    void service.onTurnEnded(event.agent, context).catch(() => undefined);
  });

  server.handle(getState, ({ refreshUsage }, { paseo }) => service.view(paseo, refreshUsage));
  server.handle(startLogin, ({ base, method, accountId }, { paseo }) => service.startLogin(paseo, base, method, accountId));
  server.handle(submitLoginCode, ({ loginId, code }) => service.submitCode(loginId, code));
  server.handle(cancelLogin, ({ loginId }) => service.cancelLogin(loginId));
  server.handle(addEnvAccount, ({ base, label, env }, { paseo }) => service.addEnvAccount(paseo, base, label, env));
  server.handle(renameAccount, async ({ accountId, label }, { paseo }) => {
    await service.rename(paseo, accountId, label);
    return { ok: true as const };
  });
  server.handle(removeAccount, async ({ accountId }, { paseo }) => {
    await service.remove(paseo, accountId);
    return { ok: true as const };
  });
  server.handle(setAccountProfile, async ({ accountId, enabled }, { paseo }) => {
    await service.setProfile(paseo, accountId, enabled);
    return { ok: true as const };
  });

  return async () => {
    stopSettings();
    await service.stop();
  };
}

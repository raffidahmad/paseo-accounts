import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { AccountsContent } from "./accounts-surface";
import type { AccountsStore } from "./store";

/**
 * Settings → Plugins → Paseo Accounts. Shows the accounts themselves, so there is nothing to open
 * and no second screen whose header Paseo has to name.
 */
export function PreferencesScreen(props: PluginSurfaceProps & { store: AccountsStore }) {
  return <AccountsContent {...props} embedded />;
}

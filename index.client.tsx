import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AccountsSurface } from "./client/accounts-surface";
import { PreferencesScreen } from "./client/settings-screen";
import { createAccountsStore } from "./client/store";

export default function contribute(client: PluginClientContext) {
  const store = createAccountsStore(client);
  store.start();

  client.addSurface("accounts", (props) => <AccountsSurface {...props} store={store} />);
  client.addSidebarItem({ id: "accounts", title: "Accounts", icon: "Users", surface: "accounts" });
  client.addSettingsScreen({
    id: "preferences",
    title: "Paseo Accounts preferences",
    icon: "SlidersHorizontal",
    Component: (props) => <PreferencesScreen {...props} onOpenAccounts={() => client.openSurface("accounts")} />,
  });

  return () => {
    store.stop();
  };
}

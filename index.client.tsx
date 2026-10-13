import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PreferencesScreen } from "./client/settings-screen";
import { createAccountsStore } from "./client/store";

export default function contribute(client: PluginClientContext) {
  const store = createAccountsStore(client);
  store.start();

  client.addSettingsScreen({
    id: "preferences",
    title: "Paseo Accounts",
    icon: "SlidersHorizontal",
    Component: (props) => <PreferencesScreen {...props} store={store} />,
  });

  return () => {
    store.stop();
  };
}

import { useHosts, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { preferences } from "../shared/preferences";

/** Settings → Plugins → zerosub. Accounts themselves live in the sidebar surface. */
export function PreferencesScreen({ theme, host, onOpenAccounts }: PluginSurfaceProps & { onOpenAccounts(): void }) {
  const settings = useSettings(preferences);
  const multiHost = useHosts().length > 1;
  const muted = { color: theme.colors.foregroundMuted };
  if (settings.status === "loading") return <Text style={muted}>Loading…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Preferences">
        <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>
        <SettingsAction label="Try again" actionLabel="Reload" onPress={() => void settings.reload()} />
        {settings.status === "invalid" ? (
          <SettingsAction label="Restore defaults" actionLabel="Reset" onPress={() => void settings.reset()} />
        ) : null}
      </SettingsSection>
    );
  }
  return (
    <>
      {multiHost ? (
        <Text style={muted}>These apply to {host.label}. Each host keeps its own accounts and preferences.</Text>
      ) : null}
      <SettingsSection title="Accounts">
        <SettingsCard>
          <SettingsAction label="Add and remove accounts for any provider" actionLabel="Open accounts" onPress={onOpenAccounts} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Profiles">
        <SettingsCard>
          <SettingsSwitch
            label="Add a profile for each new account"
            hint="Shows up in Paseo's model picker under Profiles, so a chat on that account is one tap away."
            value={settings.values.createProfiles}
            disabled={settings.saving}
            onValueChange={(createProfiles) => void settings.save({ ...settings.values, createProfiles }, settings.revision)}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

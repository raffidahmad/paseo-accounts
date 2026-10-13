import { useHosts, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { accountSubtitle, formatAge, formatPlan, usageSummary } from "../shared/format";
import type { AccountView, BaseProvider } from "../shared/model";
import { preferences } from "../shared/preferences";
import { removeAccount, renameAccount, setAccountProfile } from "../shared/rpc";
import { AddAccountModal } from "./add-account";
import { EnvAccountModal } from "./env-account";
import { describe, useStore, VISIBLE_POLL_MS, type AccountsStore } from "./store";
import { Badge, Button, Card, IconButton, UsageBar, useText } from "./ui";

type Theme = PluginSurfaceProps["theme"];

/** The accounts themselves, for Paseo's settings screen. `embedded` drops the page heading the host already shows. */
export function AccountsContent(props: PluginSurfaceProps & { store: AccountsStore; embedded?: boolean }) {
  const { theme, layout, host, store, embedded } = props;
  const { state, error } = useStore(store);
  const text = useText(theme);
  const [adding, setAdding] = useState<{ base: BaseProvider; accountId?: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshUsage = useCallback(async () => {
    setRefreshing(true);
    try {
      await store.refresh({ refreshUsage: true });
    } finally {
      setRefreshing(false);
    }
  }, [store]);
  // Each host runs its own copy of the plugin with its own accounts; Paseo's host picker switches.
  const hosts = useHosts();
  const multiHost = hosts.length > 1;
  const hostStatus = hosts.find((entry) => entry.serverId === host.id)?.status;
  const offline = hostStatus !== undefined && hostStatus !== "online";
  // Keep usage moving while the screen is open.
  useEffect(() => store.watch(VISIBLE_POLL_MS), [store]);

  return (
    <View style={{ gap: layout.compact ? 20 : 28 }}>
      <View style={{ gap: 6 }}>
        {embedded ? null : <Text style={[text.small, { fontWeight: "600", letterSpacing: 0.4 }]}>Paseo Accounts</Text>}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: embedded ? "flex-end" : "space-between", gap: 8 }}>
          {embedded ? null : (
            <Text style={text.title} accessibilityRole="header">
              Provider accounts
            </Text>
          )}
          {state ? (
            <IconButton
              theme={theme}
              icon="RefreshCw"
              label="Refresh usage"
              tooltip="Refresh usage for every account now"
              tooltipPlacement="bottom"
              busy={refreshing}
              onPress={() => void refreshUsage()}
            />
          ) : null}
        </View>
        <Text style={text.muted}>
          Add more accounts to any provider. Each one becomes its own provider in Paseo, so you choose the account and its models
          when you start a chat, or start from its profile.
        </Text>
      </View>

      {multiHost ? <HostScope theme={theme} label={host.label} /> : null}

      {error && (offline || !state) ? (
        <Card theme={theme}>
          <Text style={text.danger}>
            {offline
              ? `Can't reach ${host.label}. Its accounts are saved on that machine${
                  state ? "; this is how they looked last." : " and show up here once it reconnects."
                }`
              : `Could not reach the daemon: ${error}`}
          </Text>
          <Button
            theme={theme}
            label="Try again"
            icon="RefreshCw"
            tooltip="Ask this host for its accounts again"
            tooltipAlign="start"
            onPress={() => void store.refresh()}
          />
        </Card>
      ) : null}

      {state?.warnings.map((warning) => (
        <Card theme={theme} key={warning}>
          <Text style={text.warning}>{warning}</Text>
        </Card>
      ))}

      {!state && !error ? <Text style={text.muted}>Loading accounts…</Text> : null}

      {state
        ? state.bases.map((base) => (
            <ProviderSection
              key={base.id}
              base={base}
              accounts={state.accounts.filter((account) => account.base === base.id)}
              theme={theme}
              compact={layout.compact}
              store={store}
              onAdd={() => setAdding({ base })}
              onSignIn={(account) => setAdding({ base, accountId: account.id })}
            />
          ))
        : null}

      <ProfileSetting theme={theme} />

      {adding && adding.base.managedLogin ? (
        <AddAccountModal
          theme={theme}
          layout={layout}
          host={host}
          multiHost={multiHost}
          store={store}
          base={adding.base}
          accountId={adding.accountId}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {adding && !adding.base.managedLogin ? (
        <EnvAccountModal theme={theme} store={store} base={adding.base} onClose={() => setAdding(null)} />
      ) : null}
    </View>
  );
}

/** Says whose accounts these are when the app knows several hosts. */
function HostScope({ theme, label }: { theme: Theme; label: string }) {
const text = useText(theme);
return (
  <View
    style={{
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
    }}
  >
    <Icon name="Server" size={16} color={theme.colors.foregroundMuted} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={text.strong}>Accounts on {label}</Text>
      <Text style={text.small}>
        Only agents on this host use them. Each host keeps its own accounts and settings, so sign in on
        each host you use. Switch hosts with the host picker at the top; a host shows up there once Paseo Accounts
        is installed on it.
      </Text>
    </View>
  </View>
);
}

function ProviderSection({
base,
accounts,
theme,
compact,
store,
onAdd,
onSignIn,
}: {
base: BaseProvider;
accounts: AccountView[];
theme: Theme;
compact: boolean;
store: AccountsStore;
onAdd(): void;
onSignIn(account: AccountView): void;
}) {
const text = useText(theme);
return (
  <View style={{ gap: 10 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={text.heading} accessibilityRole="header">
        {base.label}
      </Text>
      <Button
        theme={theme}
        icon="Plus"
        label={compact ? "Add" : "Add account"}
        accessibilityLabel={`Add ${base.label} account`}
        tooltip={base.managedLogin ? `Sign in another ${base.label} account` : `Add a ${base.label} account with its own environment`}
        tooltipAlign="end"
        onPress={onAdd}
      />
    </View>
    {accounts.length === 0 ? <Text style={text.muted}>No extra {base.label} accounts yet.</Text> : null}
    {chunk(accounts, compact ? 1 : 2).map((row) => (
      <View key={row.map((account) => account.id).join()} style={{ flexDirection: "row", gap: 10 }}>
        {row.map((account) => (
          <AccountCard key={account.id} account={account} theme={theme} store={store} onSignIn={() => onSignIn(account)} />
        ))}
        {!compact && row.length === 1 ? <View style={{ flex: 1 }} /> : null}
      </View>
    ))}
  </View>
);
}

function AccountCard({
account,
theme,
store,
onSignIn,
}: {
account: AccountView;
theme: Theme;
store: AccountsStore;
onSignIn(): void;
}) {
const text = useText(theme);
const toast = useToast();
const [busy, setBusy] = useState<"remove" | "profile" | null>(null);
const [renaming, setRenaming] = useState(false);
const [confirmRemove, setConfirmRemove] = useState(false);
const plan = formatPlan(account.plan);
const summary = usageSummary(account);
const subtitle = accountSubtitle(account) ?? (account.envKeys.length > 0 ? account.envKeys.join(", ") : null);
const signedOut = account.status === "signed_out";
const faded = account.enabled ? null : { opacity: 0.55 };
const windows = account.usage?.windows ?? [];
const freshness = !signedOut && account.usage && windows.length > 0 ? `updated ${formatAge(account.usage.fetchedAt)}` : null;

// A profile starts agents on this account in one tap; Paseo lets you edit it like any other.
const toggleProfile = useCallback(async () => {
  setBusy("profile");
  try {
    await store.rpc(setAccountProfile, { accountId: account.id, enabled: !account.hasProfile });
    await store.refresh();
    toast.show(account.hasProfile ? `Removed the profile for ${account.label}` : `Added a profile for ${account.label}`, {
      variant: "success",
    });
  } catch (error) {
    toast.error(describe(error));
  } finally {
    setBusy(null);
  }
}, [account, store, toast]);

const remove = useCallback(async () => {
  setBusy("remove");
  try {
    await store.rpc(removeAccount, { accountId: account.id });
    toast.show(`Removed ${account.label}`, { variant: "success" });
    await store.refresh();
  } catch (error) {
    toast.error(describe(error));
  } finally {
    setBusy(null);
    setConfirmRemove(false);
  }
}, [account, store, toast]);

return (
  <Card theme={theme} fill>
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={faded}>
        <Avatar theme={theme} label={account.label} />
      </View>
      <View style={[{ flex: 1, minWidth: 0, gap: 3 }, faded]}>
        <Text style={text.strong} numberOfLines={1}>
          {account.label}
        </Text>
        {subtitle ? (
          <Text style={text.small} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: -4, marginRight: -6 }}>
        <IconButton theme={theme} icon="Pencil" label="Rename" tooltip="Rename this account" onPress={() => setRenaming(true)} />
        {account.kind !== "main" ? (
          <IconButton
            theme={theme}
            icon="Trash2"
            label="Remove"
            tooltip="Remove: delete its provider and profile, and sign it out"
            tone="danger"
            busy={busy === "remove"}
            onPress={() => setConfirmRemove(true)}
          />
        ) : null}
      </View>
    </View>

    <View style={[{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }, faded]}>
      {plan ? <Badge theme={theme} label={plan} /> : null}
      {account.kind === "main" ? <Badge theme={theme} label="CLI login" /> : null}
      {!account.enabled ? <Badge theme={theme} label="Off in Paseo" /> : null}
      {account.hasProfile ? <Badge theme={theme} label="Profile" tone="accent" /> : null}
      {account.status === "limited" ? <Badge theme={theme} label="Limit reached" tone="danger" /> : null}
      {signedOut ? <Badge theme={theme} label="Signed out" tone="warning" /> : null}
    </View>

    {account.managedLogin ? (
      <View style={[{ gap: 10 }, faded]}>
        {signedOut ? (
          <Text style={text.small}>Sign in again to use this account.</Text>
        ) : windows.length > 0 ? (
          windows.map((limit) => <UsageBar key={limit.id} theme={theme} limit={limit} />)
        ) : (
          <Text style={text.small}>{account.usage?.error ?? summary ?? "Checking usage…"}</Text>
        )}
        {!signedOut && windows.length > 0 && account.usage?.error ? <Text style={text.small}>{account.usage.error}</Text> : null}
      </View>
    ) : (
      <Text style={text.small}>Runs with the environment you gave it. Usage isn't tracked for this provider.</Text>
    )}

    {/* Pinned to the bottom, so cards side by side line up however much each one shows. */}
    <View
      style={{
        marginTop: "auto",
        minHeight: 38,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        columnGap: 8,
        rowGap: 8,
      }}
    >
      <Text style={[text.small, { flexShrink: 1 }]} numberOfLines={1}>
        {freshness ?? (account.enabled ? " " : "Turned off in Paseo's providers")}
      </Text>
      {signedOut ? (
        <Button
          theme={theme}
          size="small"
          tone="primary"
          icon="LogIn"
          label="Sign in"
          tooltip="Sign this account in again"
          tooltipAlign="end"
          onPress={onSignIn}
        />
      ) : (
        <Button
          theme={theme}
          size="small"
          icon={account.hasProfile ? "BookmarkMinus" : "BookmarkPlus"}
          label={account.hasProfile ? "Remove profile" : "Add profile"}
          tooltip={
            account.hasProfile
              ? "Remove this account's Paseo profile (the account stays)"
              : "Add a Paseo profile that starts chats on this account"
          }
          tooltipAlign="end"
          busy={busy === "profile"}
          onPress={() => void toggleProfile()}
        />
      )}
    </View>

    {renaming ? <RenameModal theme={theme} account={account} store={store} onClose={() => setRenaming(false)} /> : null}
    <Modal title={`Remove ${account.label}?`} open={confirmRemove} onOpenChange={setConfirmRemove}>
      <Modal.Content>
        <Text style={text.body}>
          {account.managedLogin
            ? "This deletes the account's provider and profiles in Paseo, signs it out on this machine and deletes its saved login."
            : "This deletes the account's provider and profiles in Paseo, including the environment variables you gave it."}{" "}
          Agents already running on it will stop working, so archive them first. Their conversations are kept.
        </Text>
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Button theme={theme} label="Cancel" tooltip="Keep this account" tooltipAlign="end" onPress={() => setConfirmRemove(false)} />
          <Button
            theme={theme}
            tone="danger"
            icon="Trash2"
            label="Remove"
            tooltip="Delete the provider and profile, and sign it out"
            tooltipAlign="end"
            busy={busy === "remove"}
            onPress={() => void remove()}
          />
        </View>
      </Modal.Content>
    </Modal>
  </Card>
);
}

function RenameModal({
theme,
account,
store,
onClose,
}: {
theme: Theme;
account: AccountView;
store: AccountsStore;
onClose(): void;
}) {
const text = useText(theme);
const toast = useToast();
const [label, setLabel] = useState(account.label);
const [saving, setSaving] = useState(false);
const save = useCallback(async () => {
  const next = label.trim();
  if (!next) return;
  setSaving(true);
  try {
    await store.rpc(renameAccount, { accountId: account.id, label: next });
    await store.refresh();
    onClose();
  } catch (error) {
    toast.error(describe(error));
  } finally {
    setSaving(false);
  }
}, [label, account.id, store, onClose, toast]);
const inputStyle = useMemo(
  () => ({
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  }),
  [theme],
);
return (
  <Modal title="Rename account" open onOpenChange={(open) => (open ? undefined : onClose())}>
    <Modal.Content>
      <Text style={text.muted}>A short name you'll recognise in the composer, like "Work" or "Personal".</Text>
      <TextInput
        value={label}
        onChangeText={setLabel}
        autoFocus
        maxLength={40}
        placeholder="Account name"
        placeholderTextColor={theme.colors.foregroundMuted}
        onSubmitEditing={() => void save()}
        style={inputStyle}
        accessibilityLabel="Account name"
      />
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
        <Button theme={theme} label="Cancel" tooltip="Keep the current name" tooltipAlign="end" onPress={onClose} />
        <Button
          theme={theme}
          tone="primary"
          label="Save"
          tooltip="Save the new name"
          tooltipAlign="end"
          busy={saving}
          disabled={!label.trim()}
          onPress={() => void save()}
        />
      </View>
    </Modal.Content>
  </Modal>
);
}

function Avatar({ theme, label }: { theme: Theme; label: string }) {
const initial = label.trim().charAt(0).toUpperCase() || "?";
return (
  <View
    style={{
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surface2,
      borderWidth: 1,
      borderColor: theme.colors.border,
    }}
  >
    <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "700" }}>{initial}</Text>
  </View>
);
}

function ProfileSetting({ theme }: { theme: Theme }) {
const settings = useSettings(preferences);
const text = useText(theme);
if (settings.status === "loading") return null;
if (settings.status !== "ready") {
  return <Text style={text.danger}>Preferences unavailable: {settings.error}</Text>;
}
return (
  <View style={{ gap: 10 }}>
    <Text style={text.heading} accessibilityRole="header">
      Profiles
    </Text>
    <SettingsCard>
      <SettingsSwitch
        label="Add a profile for each new account"
        hint="Shows up in Paseo's model picker under Profiles, so a chat on that account is one tap away."
        value={settings.values.createProfiles}
        disabled={settings.saving}
        onValueChange={(createProfiles) => void settings.save({ ...settings.values, createProfiles }, settings.revision)}
      />
    </SettingsCard>
    {settings.saveError ? <Text style={text.danger}>{settings.saveError}</Text> : null}
    </View>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}


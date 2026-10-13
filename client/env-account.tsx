import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { BaseProvider } from "../shared/model";
import { addEnvAccount } from "../shared/rpc";
import { describe, type AccountsStore } from "./store";
import { Button, useText } from "./ui";

type Theme = PluginSurfaceProps["theme"];

/** One `KEY=value` per line; blank lines and `#` comments are skipped. Returns the first bad line instead of guessing. */
export function parseEnvLines(input: string): { env: Record<string, string>; error: string | null } {
  const env: Record<string, string> = {};
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) return { env: {}, error: `“${line.length > 30 ? `${line.slice(0, 30)}…` : line}” isn't KEY=value.` };
    env[match[1] ?? ""] = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
  }
  return { env, error: null };
}

/** An account for a provider without managed sign-in: a name plus the environment it runs with. */
export function EnvAccountModal({
  theme,
  store,
  base,
  onClose,
}: {
  theme: Theme;
  store: AccountsStore;
  base: BaseProvider;
  onClose(): void;
}) {
  const text = useText(theme);
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [lines, setLines] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputStyle = useMemo(
    () => ({
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    }),
    [theme],
  );

  const save = useCallback(async () => {
    const parsed = parseEnvLines(lines);
    if (parsed.error) return setError(parsed.error);
    setSaving(true);
    setError(null);
    try {
      await store.rpc(addEnvAccount, { base: base.id, label: label.trim(), env: parsed.env });
      await store.refresh();
      toast.show(`Added ${label.trim()}. Find it under ${base.label} when you start a chat.`, { variant: "success" });
      onClose();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setSaving(false);
    }
  }, [lines, label, base, store, toast, onClose]);

  return (
    <Modal title={`Add ${base.label} account`} open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Modal.Content>
        <Text style={text.muted}>
          Paseo Accounts can't sign in to {base.label} for you, so this account is a name plus the environment variables it runs with, such
          as an API key or a separate config folder. It becomes its own provider in Paseo.
        </Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          autoFocus
          maxLength={40}
          placeholder="Account name, e.g. Work"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={inputStyle}
          accessibilityLabel="Account name"
        />
        <TextInput
          value={lines}
          onChangeText={setLines}
          multiline
          numberOfLines={5}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={"One per line:\nMY_API_KEY=…\nMY_CONFIG_DIR=/path"}
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[inputStyle, { minHeight: 110, textAlignVertical: "top" }]}
          accessibilityLabel="Environment variables"
        />
        <Text style={text.small}>Values are stored in Paseo's provider config on this host, like any provider's environment.</Text>
        {error ? <Text style={text.danger}>{error}</Text> : null}
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Button theme={theme} label="Cancel" tooltip="Close without adding an account" tooltipAlign="end" onPress={onClose} />
          <Button
            theme={theme}
            tone="primary"
            label="Add account"
            tooltip="Create the provider for this account"
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

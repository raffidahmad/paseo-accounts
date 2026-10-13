import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { LoginMethodSchema, LoginViewSchema, StateViewSchema } from "./model";

export const getState = defineRpc({
  name: "zerosub.state",
  input: z.object({ refreshUsage: z.boolean().optional() }),
  output: StateViewSchema,
});

export const startLogin = defineRpc({
  name: "zerosub.login.start",
  input: z.object({
    /** The built-in provider to add an account to. */
    base: z.string(),
    /** Sign an existing account back in instead of adding a new one. */
    accountId: z.string().optional(),
    method: LoginMethodSchema.default("browser"),
  }),
  output: LoginViewSchema,
});

export const submitLoginCode = defineRpc({
  name: "zerosub.login.code",
  input: z.object({ loginId: z.string(), code: z.string().trim().min(1) }),
  output: LoginViewSchema,
});

export const cancelLogin = defineRpc({
  name: "zerosub.login.cancel",
  input: z.object({ loginId: z.string() }),
  output: LoginViewSchema.nullable(),
});

/** An account on a provider without managed sign-in: a name plus the environment it runs with. */
export const addEnvAccount = defineRpc({
  name: "zerosub.accounts.addEnv",
  input: z.object({
    base: z.string(),
    label: z.string().trim().min(1).max(40),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()),
  }),
  output: z.object({ accountId: z.string() }),
});

export const renameAccount = defineRpc({
  name: "zerosub.accounts.rename",
  input: z.object({ accountId: z.string(), label: z.string().trim().min(1).max(40) }),
  output: z.object({ ok: z.literal(true) }),
});

export const removeAccount = defineRpc({
  name: "zerosub.accounts.remove",
  input: z.object({ accountId: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

/** Adds or removes the Paseo profile that starts agents on an account. */
export const setAccountProfile = defineRpc({
  name: "zerosub.accounts.profile",
  input: z.object({ accountId: z.string(), enabled: z.boolean() }),
  output: z.object({ ok: z.literal(true) }),
});

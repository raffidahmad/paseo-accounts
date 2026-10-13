import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 2,
  // Version 1 held the failover options, which no longer exist.
  migrate: () => ({}),
  schema: z.object({
    /** Give every account you add a Paseo profile, so it's one tap away when starting a chat. */
    createProfiles: z.boolean().default(true),
  }),
});

export type Preferences = z.output<typeof preferences.schema>;

export const DEFAULT_PREFERENCES: Preferences = { createProfiles: true };

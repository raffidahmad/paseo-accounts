import { build } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * Paseo evaluates the client bundle with `eval` on mobile, and Hermes can't construct a class
 * defined there ("Cannot read property 'prototype' of undefined"). The plugin's own client code and
 * anything it bundles must not contain one. Peer dependencies the host provides (React, Zod, the Paseo packages) stay external.
 */
describe("client bundle", () => {
  it("has no classes, which Hermes can't construct inside eval", async () => {
    const result = await build({
      entryPoints: ["index.client.tsx"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      mainFields: ["module", "main"],
      conditions: ["import", "module"],
      jsx: "automatic",
      logLevel: "silent",
      external: ["react", "react/*", "react-native", "react-native/*", "@getpaseo/*", "zod", "zod/*"],
    });
    const code = result.outputFiles.map((file) => file.text).join("\n");
    const classes = [...code.matchAll(/(^|[^\w$.])class\s+[\w$]*\s*(extends\s+[\w$.()]+\s*)?\{/gm)].map((match) => match[0].trim());
    expect(classes).toEqual([]);
  });
});

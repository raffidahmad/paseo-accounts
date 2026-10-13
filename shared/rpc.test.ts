import { describe, expect, it } from "vitest";
import * as rpc from "./rpc";

/** Paseo rejects the whole plugin at install time if one RPC name breaks its rules (lowercase, no spaces). */
describe("RPC contracts", () => {
  it("have unique names Paseo accepts", () => {
    const names = Object.values(rpc).map((contract) => contract.name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9._-]*$/);
    expect(new Set(names).size).toBe(names.length);
  });
});

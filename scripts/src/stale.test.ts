import { describe, it, expect } from "vitest";
import { staleStacks } from "./stale.js";

describe("staleStacks (after floci reset, stack records outlive their resources)", () => {
  it("returns our stacks + CDKToolkit when the bootstrap param is gone", () => {
    expect(staleStacks(["CDKToolkit", "ig-local-core", "someone-else"], false))
      .toEqual(["ig-local-core", "CDKToolkit"]);
  });

  it("returns nothing when the bootstrap param still exists", () => {
    expect(staleStacks(["CDKToolkit", "ig-local-core"], true)).toEqual([]);
  });
});

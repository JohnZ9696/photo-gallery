import { describe, expect, it } from "vitest";
import { planVariantWidths, variantKey, variantKind } from "./variants.js";

describe("planVariantWidths", () => {
  it("does not upscale a small image", () => {
    expect(planVariantWidths(300)).toEqual([300]);
  });

  it("adds the native width when there is room", () => {
    expect(planVariantWidths(800)).toEqual([480, 800]);
  });

  it("returns at most three configured widths", () => {
    expect(planVariantWidths(2000)).toEqual([480, 1024, 1600]);
    expect(planVariantWidths(5000)).toEqual([480, 1024, 1600]);
  });

  it("handles invalid width safely", () => {
    expect(planVariantWidths(0)).toEqual([]);
  });
});

describe("variant naming", () => {
  it("maps indexes to stable kinds", () => {
    expect(variantKind(0)).toBe("thumb");
    expect(variantKind(1)).toBe("medium");
    expect(variantKind(2)).toBe("large");
  });

  it("builds versioned relative storage keys", () => {
    expect(variantKey("p01", 2, "large", 1600)).toBe(
      "photos/p01/v2/large-1600w.webp",
    );
  });
});

import { describe, expect, it } from "vitest";
import { viewModes } from "../src/domain/pipeline";
import {
  fromLinear,
  toLinear,
  transformPixel,
  transformPixels,
} from "../src/lib/vision/transforms";
describe("linear sRGB screening transforms", () => {
  it("round-trips byte values and leaves neutral black/white unchanged", () => {
    for (let value = 0; value < 256; value++) expect(fromLinear(toLinear(value))).toBe(value);
    for (const mode of viewModes) {
      expect(transformPixel(0, 0, 0, mode)).toEqual([0, 0, 0]);
      expect(transformPixel(255, 255, 255, mode)).toEqual([255, 255, 255]);
    }
  });
  it("uses published full-severity coefficients in linear light, not encoded RGB", () => {
    expect(transformPixel(255, 0, 0, "protan")).toEqual([109, 95, 0]);
    expect(transformPixel(255, 0, 0, "deutan")).toEqual([163, 144, 0]);
    expect(transformPixel(255, 0, 0, "grayscale")).toEqual([127, 127, 127]);
    const source = new Uint8ClampedArray([255, 0, 0, 71]);
    const output = transformPixels(source, "protan");
    expect(output[3]).toBe(71);
    expect(source).toEqual(new Uint8ClampedArray([255, 0, 0, 71]));
  });
  it("uses the published partial red-green matrices rather than reusing full-loss images", () => {
    expect(transformPixel(255, 0, 0, "protanomaly")).toEqual([180, 86, 0]);
    expect(transformPixel(255, 0, 0, "deuteranomaly")).toEqual([195, 118, 0]);
    expect(transformPixel(255, 0, 0, "protanomaly")).not.toEqual(
      transformPixel(255, 0, 0, "protan"),
    );
  });
  it("selects both Brettel tritan half-planes and interpolates partial loss in linear light", () => {
    // Reference plane columns from libDaltonLens, independently sRGB-encoded to nearest byte.
    expect(transformPixel(255, 0, 0, "tritan")).toEqual([255, 0, 78]);
    expect(transformPixel(0, 255, 0, "tritan")).toEqual([121, 233, 255]);
    expect(transformPixel(0, 0, 255, "tritan")).toEqual([0, 98, 136]);
    const partial = transformPixel(255, 0, 0, "tritanomaly");
    expect(partial).toEqual([255, 0, fromLinear(0.07589 * 0.5)]);
    expect(partial[2]).not.toBe(Math.round(78 * 0.5));
  });
  it("preserves alpha and source pixels and stays in gamut for every screening view", () => {
    const source = new Uint8ClampedArray([255, 0, 0, 71, 0, 255, 0, 103, 0, 0, 255, 0]);
    const copy = source.slice();
    for (const mode of viewModes) {
      const transformed = transformPixels(source, mode);
      expect([transformed[3], transformed[7], transformed[11]]).toEqual([71, 103, 0]);
      expect(Array.from(transformed).every((v) => Number.isFinite(v) && v >= 0 && v <= 255)).toBe(
        true,
      );
    }
    expect(source).toEqual(copy);
  });
});

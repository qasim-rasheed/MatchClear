import { describe, expect, it } from "vitest";
import {
  fromLinear,
  toLinear,
  transformPixel,
  transformPixels,
} from "../src/lib/vision/transforms";
describe("linear sRGB screening transforms", () => {
  it("round-trips byte values and leaves neutral black/white unchanged", () => {
    for (let value = 0; value < 256; value++) expect(fromLinear(toLinear(value))).toBe(value);
    for (const mode of ["normal", "grayscale", "protan", "deutan"] as const) {
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
});

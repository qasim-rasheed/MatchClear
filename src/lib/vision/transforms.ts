import type { ViewMode } from "@/domain/pipeline";

// Machado et al. (2009), severity 1.0, linear sRGB matrices.
// Primary implementation reference and license: THIRD_PARTY_NOTICES.md.
const matrices = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};
export function toLinear(byte: number) {
  const x = byte / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
export function fromLinear(x: number) {
  const v = Math.max(0, Math.min(1, x));
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
}
export function transformPixel(
  r: number,
  g: number,
  b: number,
  mode: ViewMode,
): [number, number, number] {
  if (mode === "normal") return [r, g, b];
  const rgb = [toLinear(r), toLinear(g), toLinear(b)];
  if (mode === "grayscale") {
    const v = fromLinear(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
    return [v, v, v];
  }
  return matrices[mode].map((row) =>
    fromLinear(row.reduce((sum, value, i) => sum + value * rgb[i], 0)),
  ) as [number, number, number];
}
export function transformPixels(data: Uint8ClampedArray, mode: ViewMode) {
  const output = new Uint8ClampedArray(data);
  if (mode === "normal") return output;
  for (let i = 0; i < output.length; i += 4) {
    const rgb = transformPixel(data[i], data[i + 1], data[i + 2], mode);
    output[i] = rgb[0];
    output[i + 1] = rgb[1];
    output[i + 2] = rgb[2];
  }
  return output;
}

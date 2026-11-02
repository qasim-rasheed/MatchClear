import type { ViewMode } from "@/domain/pipeline";

// Machado et al. (2009), settings 1.0 and 0.5, in linear sRGB.
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
  protanomaly: [
    [0.458064, 0.679578, -0.137642],
    [0.092785, 0.846313, 0.060902],
    [-0.007494, -0.016807, 1.024301],
  ],
  deuteranomaly: [
    [0.547494, 0.607765, -0.155259],
    [0.181692, 0.781742, 0.036566],
    [-0.01041, 0.027275, 0.983136],
  ],
};
// Brettel 1997 tritan parameters, libDaltonLens (public domain), sRGB/Smith–Pokorny.
const tritanPlanes = [
  [
    [1.01277, 0.13548, -0.14826],
    [-0.01243, 0.86812, 0.14431],
    [0.07589, 0.805, 0.11911],
  ],
  [
    [0.93678, 0.18979, -0.12657],
    [0.06154, 0.81526, 0.1232],
    [-0.37562, 1.12767, 0.24796],
  ],
];
const tritanSeparation = [0.03901, -0.02788, -0.01113];
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
  if (mode === "tritan" || mode === "tritanomaly") {
    const side = rgb.reduce((sum, value, i) => sum + value * tritanSeparation[i], 0) >= 0 ? 0 : 1;
    // Partial tritan is a clearly labelled interpolation approximation, not a clinical severity.
    const amount = mode === "tritanomaly" ? 0.5 : 1;
    return tritanPlanes[side].map((row, channel) => {
      const projected = row.reduce((sum, value, i) => sum + value * rgb[i], 0);
      return fromLinear(projected * amount + rgb[channel] * (1 - amount));
    }) as [number, number, number];
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

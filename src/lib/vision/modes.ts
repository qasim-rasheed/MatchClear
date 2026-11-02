import type { ViewMode } from "@/domain/pipeline";
export const modeLabels: Record<ViewMode, string> = {
  normal: "Ordinary",
  grayscale: "Grayscale",
  protan: "Protan model",
  deutan: "Deutan model",
  protanomaly: "Protanomaly",
  deuteranomaly: "Deuteranomaly",
  tritan: "Tritan model",
  tritanomaly: "Tritanomaly",
};
export const modeDetails: Record<ViewMode, { name: string; hint: string; explanation: string }> = {
  normal: {
    name: "Ordinary",
    hint: "Original colour view",
    explanation:
      "The generated image without a colour-vision transform. This is a reference view, not a colour-blindness condition.",
  },
  grayscale: {
    name: "Grayscale",
    hint: "No-colour contrast check",
    explanation:
      "Removes hue to inspect light/dark differences. It approximates colour removal only; it does not simulate all effects of achromatopsia, monochromacy, reduced acuity or light sensitivity.",
  },
  protan: {
    name: "Protanopia",
    hint: "Red–green · complete-loss model",
    explanation:
      "Protan-family complete-loss screening using the Machado model at setting 1.0. Individual perception varies.",
  },
  protanomaly: {
    name: "Protanomaly",
    hint: "Red–green · partial-loss example",
    explanation:
      "Protan-family partial-loss screening using the published Machado setting 0.5. This is one example, not a measurement of a person's vision.",
  },
  deutan: {
    name: "Deuteranopia",
    hint: "Red–green · complete-loss model",
    explanation:
      "Deutan-family complete-loss screening using the Machado model at setting 1.0. Individual perception varies.",
  },
  deuteranomaly: {
    name: "Deuteranomaly",
    hint: "Red–green · partial-loss example",
    explanation:
      "Deutan-family partial-loss screening using the published Machado setting 0.5. This is one example, not a measurement of a person's vision.",
  },
  tritan: {
    name: "Tritanopia",
    hint: "Blue–yellow · complete-loss model",
    explanation:
      "Tritan-family screening using the two-plane Brettel model adapted to sRGB. A model cannot reproduce everyone's perception.",
  },
  tritanomaly: {
    name: "Tritanomaly",
    hint: "Blue–yellow · partial-loss approximation",
    explanation:
      "A 0.5 linear-light interpolation between the ordinary and Brettel tritan result. This is a rough approximation, not a clinically validated severity simulation.",
  },
};

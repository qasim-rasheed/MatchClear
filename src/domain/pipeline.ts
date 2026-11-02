import { z } from "zod";

export const TRANSFORM_VERSION = "screening-srgb-eight-views-v2";
export const REGION_VERSION = "shirt-polygon-v1";
// Polygon geometry did not change when the screening coverage expanded.
export function supportedRegion(region: { transformVersion: string } | null | undefined) {
  return Boolean(
    region && [REGION_VERSION, "machado2009-srgb-v1"].includes(region.transformVersion),
  );
}
export const viewModes = [
  "normal",
  "grayscale",
  "protan",
  "protanomaly",
  "deutan",
  "deuteranomaly",
  "tritan",
  "tritanomaly",
] as const;
export type ViewMode = (typeof viewModes)[number];
export type Point = { x: number; y: number };
const id = z.string().min(1).max(100);
const base = { eventId: id, revision: z.number().int().positive() };
const reviewer = z.string().trim().min(2).max(80);
const reason = z.string().trim().min(5).max(1000);
export const regionPolygon = z
  .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
  .min(3)
  .max(12)
  .refine(
    (p) => polygonArea(p) >= 0.005,
    "Mark a visible shirt area, with points in outline order.",
  );
export const pipelineCommand = z.discriminatedUnion("op", [
  z.object({
    ...base,
    op: z.literal("queuePreviews"),
    consentConfirmed: z.literal(true),
    items: z
      .array(z.object({ teamId: id, designId: id }))
      .min(1)
      .max(8),
    retryFailed: z.boolean().default(false),
  }),
  z.object({
    ...base,
    op: z.literal("acceptPreview"),
    previewId: id,
    acceptance: z.enum(["accepted", "rejected"]),
    reviewer,
    reason,
  }),
  z.object({ ...base, op: z.literal("saveRegion"), previewId: id, polygon: regionPolygon }),
  z.object({
    ...base,
    op: z.literal("reviewPair"),
    fixtureId: id,
    optionA: id,
    optionB: id,
    previewA: id,
    previewB: id,
    status: z.enum(["approved", "rejected", "inconclusive"]),
    reviewer,
    reason,
    viewedModes: z
      .array(z.enum(viewModes))
      .refine(
        (a) => viewModes.every((m) => a.includes(m)),
        `Inspect all ${viewModes.length} view modes before recording a decision.`,
      ),
  }),
  z.object({
    ...base,
    op: z.literal("queuePlan"),
    locks: z.record(z.string(), z.string()).default({}),
    baseline: z.record(z.string(), z.string()).default({}),
  }),
  z.object({ ...base, op: z.literal("cancelJob"), jobId: id }),
  z.object({ ...base, op: z.literal("resumeJob"), jobId: id }),
  z.object({ ...base, op: z.literal("deleteAsset"), assetId: id }),
]);
export function polygonArea(points: Point[]) {
  return (
    Math.abs(
      points.reduce((sum, p, i) => {
        const n = points[(i + 1) % points.length];
        return sum + p.x * n.y - n.x * p.y;
      }, 0),
    ) / 2
  );
}
export type ReviewEvidence = {
  previewA: string;
  previewB: string;
  revisionA: number;
  revisionB: number;
  regionA: string;
  regionB: string;
  regionRevisionA: number;
  regionRevisionB: number;
  designRevisionA: number;
  designRevisionB: number;
  transformVersion: string;
  viewedModes: string[];
};
export function previewKey(
  teamId: string,
  designId: string,
  personHash: string,
  referenceHash: string,
  designRevision: number,
) {
  return [
    teamId,
    designId,
    personHash,
    referenceHash,
    designRevision,
    "cloth-v3",
    "upper_body",
  ].join(":");
}

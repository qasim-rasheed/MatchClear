import { z } from "zod";

export const sizeKeys = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export const quantitiesSchema = z.object(
  Object.fromEntries(sizeKeys.map((s) => [s, z.number().int().min(0).max(1000)])) as Record<
    (typeof sizeKeys)[number],
    z.ZodNumber
  >,
);
const name = z.string().trim().min(2).max(80);
const id = z.string().min(1).max(80);
const revision = z.number().int().positive();
const extraQuantitiesSchema = quantitiesSchema
  .partial()
  .transform((q) => ({ XS: 0, S: 0, M: 0, L: 0, XL: 0, XXL: 0, ...q }));
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const date = z
  .string()
  .refine(
    (v) =>
      !v ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number.isFinite(new Date(v).getTime()) &&
        new Date(v).toISOString().slice(0, 10) === v),
    "Choose a valid date",
  );
export const eventInput = z.object({
  name,
  currency: z.enum(["EUR", "GBP", "USD"]),
  budgetMinor: z.number().int().min(0).max(100_000_000),
  eventDate: date,
});
export const mutationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("createEvent"), input: eventInput }),
  z.object({
    op: z.literal("importTeams"),
    eventId: id,
    revision,
    input: z.object({
      rows: z
        .array(
          z.object({
            name,
            code: z
              .string()
              .trim()
              .min(2)
              .max(4)
              .regex(/^[A-Za-z0-9]+$/),
            quantities: quantitiesSchema,
          }),
        )
        .min(1)
        .max(100),
    }),
  }),
  z.object({
    op: z.literal("importFixtures"),
    eventId: id,
    revision,
    input: z.object({
      rows: z
        .array(z.object({ label: name, teamA: id, teamB: id }))
        .min(1)
        .max(100),
    }),
  }),
  z.object({ op: z.literal("updateEvent"), eventId: id, revision, input: eventInput }),
  z.object({ op: z.literal("archiveEvent"), eventId: id, revision }),
  z.object({
    op: z.literal("addTeam"),
    eventId: id,
    revision,
    input: z.object({
      name,
      code: z
        .string()
        .trim()
        .min(2)
        .max(4)
        .regex(/^[A-Za-z0-9]+$/),
      quantities: quantitiesSchema,
    }),
  }),
  z.object({
    op: z.literal("updateTeam"),
    eventId: id,
    revision,
    teamId: id,
    input: z.object({
      name,
      code: z
        .string()
        .trim()
        .min(2)
        .max(4)
        .regex(/^[A-Za-z0-9]+$/),
      quantities: quantitiesSchema,
    }),
  }),
  z.object({
    op: z.literal("addFixture"),
    eventId: id,
    revision,
    input: z.object({ teamA: id, teamB: id, label: name }),
  }),
  z.object({ op: z.literal("removeFixture"), eventId: id, revision, fixtureId: id }),
  z.object({
    op: z.literal("addDesign"),
    eventId: id,
    revision,
    input: z.object({
      name,
      colour: name,
      primaryHex: hex,
      secondaryHex: hex,
      pattern: z.enum(["solid", "panel", "stripe"]),
    }),
  }),
  z.object({
    op: z.literal("updateDesign"),
    eventId: id,
    revision,
    designId: id,
    input: z.object({
      name,
      colour: name,
      primaryHex: hex,
      secondaryHex: hex,
      pattern: z.enum(["solid", "panel", "stripe"]),
    }),
  }),
  z.object({
    op: z.literal("addOption"),
    eventId: id,
    revision,
    input: z.object({
      teamId: id,
      designId: id,
      owned: z.boolean(),
      unitMinor: z.number().int().min(0).max(1_000_000),
      setupMinor: z.number().int().min(0).max(1_000_000),
      minimumOrder: z.number().int().min(0).max(1000),
      stock: quantitiesSchema,
      extraQuantities: extraQuantitiesSchema
        .optional()
        .default({ XS: 0, S: 0, M: 0, L: 0, XL: 0, XXL: 0 }),
      available: z.boolean(),
      seller: z.string().trim().max(120),
      priceDate: date,
    }),
  }),
  z.object({
    op: z.literal("updateOption"),
    eventId: id,
    revision,
    optionId: id,
    input: z.object({
      unitMinor: z.number().int().min(0).max(1_000_000),
      setupMinor: z.number().int().min(0).max(1_000_000),
      minimumOrder: z.number().int().min(0).max(1000),
      stock: quantitiesSchema,
      extraQuantities: extraQuantitiesSchema
        .optional()
        .default({ XS: 0, S: 0, M: 0, L: 0, XL: 0, XXL: 0 }),
      available: z.boolean(),
      seller: z.string().trim().max(120),
      priceDate: date,
    }),
  }),
]);
export type Mutation = z.infer<typeof mutationSchema>;
export function moneyToMinor(value: string): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a positive amount with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}
export function totalQuantity(q: Record<string, number>) {
  return Object.values(q).reduce((a, b) => a + b, 0);
}
export function quoteOption(
  option: {
    owned: boolean;
    unitMinor: number;
    setupMinor: number;
    minimumOrder: number;
    stock: Record<string, number>;
    available: boolean;
    extraQuantities?: Record<string, number>;
  },
  demand: Record<string, number>,
) {
  const requested = totalQuantity(demand);
  const allocated = requested + totalQuantity(option.extraQuantities || {});
  const orderQuantity = option.owned ? requested : Math.max(allocated, option.minimumOrder);
  const sizesAvailable = Object.entries(demand).every(
    ([size, amount]) =>
      (option.stock[size] ?? 0) >=
      amount + (option.owned ? 0 : option.extraQuantities?.[size] || 0),
  );
  return {
    requested,
    orderQuantity,
    extraUnits: orderQuantity - requested,
    totalMinor: option.owned ? 0 : orderQuantity * option.unitMinor + option.setupMinor,
    eligible: option.available && requested > 0 && sizesAvailable,
    minimumOrderNeedsSizes: !option.owned && orderQuantity > allocated,
  };
}

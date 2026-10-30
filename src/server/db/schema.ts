import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  budgetMinor: integer("budget_minor").notNull(),
  eventDate: text("event_date"),
  revision: integer("revision").notNull().default(1),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  sample: integer("sample", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const teams = sqliteTable(
  "teams",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    quantities: text("quantities", { mode: "json" }).$type<Record<string, number>>().notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [uniqueIndex("team_event_name").on(t.eventId, t.name)],
);
export const fixtures = sqliteTable(
  "fixtures",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    teamA: text("team_a")
      .notNull()
      .references(() => teams.id),
    teamB: text("team_b")
      .notNull()
      .references(() => teams.id),
    pairKey: text("pair_key").notNull(),
    label: text("label").notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [uniqueIndex("fixture_event_pair").on(t.eventId, t.pairKey)],
);
export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  kind: text("kind").notNull(),
  relativePath: text("relative_path").notNull(),
  sha256: text("sha256").notNull(),
  mime: text("mime").notNull(),
  permission: text("permission", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull().default(1),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
});
export const designs = sqliteTable("designs", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  name: text("name").notNull(),
  colour: text("colour").notNull(),
  primaryHex: text("primary_hex").notNull(),
  secondaryHex: text("secondary_hex").notNull(),
  pattern: text("pattern").notNull(),
  imageKind: text("image_kind").notNull().default("illustration"),
  assetId: text("asset_id").references(() => assets.id),
  revision: integer("revision").notNull().default(1),
});
export const options = sqliteTable("shirt_options", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  designId: text("design_id")
    .notNull()
    .references(() => designs.id),
  owned: integer("owned", { mode: "boolean" }).notNull(),
  unitMinor: integer("unit_minor").notNull(),
  setupMinor: integer("setup_minor").notNull(),
  minimumOrder: integer("minimum_order").notNull(),
  stock: text("stock", { mode: "json" }).$type<Record<string, number>>().notNull(),
  available: integer("available", { mode: "boolean" }).notNull().default(true),
  seller: text("seller").notNull(),
  priceDate: text("price_date").notNull(),
  illustrative: integer("illustrative", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull().default(1),
});
export const previews = sqliteTable("previews", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  designId: text("design_id")
    .notNull()
    .references(() => designs.id),
  personAssetId: text("person_asset_id")
    .notNull()
    .references(() => assets.id),
  referenceAssetId: text("reference_asset_id")
    .notNull()
    .references(() => assets.id),
  outputAssetId: text("output_asset_id").references(() => assets.id),
  inputHash: text("input_hash").notNull(),
  apiVersion: text("api_version").notNull(),
  parameters: text("parameters", { mode: "json" }).notNull(),
  providerTaskId: text("provider_task_id"),
  status: text("status").notNull(),
  revision: integer("revision").notNull().default(1),
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});
export const regions = sqliteTable("shirt_regions", {
  id: text("id").primaryKey(),
  previewId: text("preview_id")
    .notNull()
    .references(() => previews.id),
  polygon: text("polygon", { mode: "json" }).notNull(),
  transformVersion: text("transform_version").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  fixtureId: text("fixture_id")
    .notNull()
    .references(() => fixtures.id),
  optionA: text("option_a")
    .notNull()
    .references(() => options.id),
  optionB: text("option_b")
    .notNull()
    .references(() => options.id),
  status: text("status").notNull(),
  reviewer: text("reviewer").notNull(),
  reason: text("reason").notNull(),
  evidence: text("evidence", { mode: "json" }).notNull(),
  revision: integer("revision").notNull().default(1),
  staleReason: text("stale_reason"),
  createdAt: text("created_at").notNull(),
});
export const plans = sqliteTable("planning_runs", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  eventRevision: integer("event_revision").notNull(),
  status: text("status").notNull(),
  snapshot: text("snapshot", { mode: "json" }).notNull(),
  totalMinor: integer("total_minor"),
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});
export const exportsTable = sqliteTable("exports", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  snapshot: text("snapshot", { mode: "json" }).notNull(),
  createdAt: text("created_at").notNull(),
});
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  providerTaskId: text("provider_task_id"),
  leaseUntil: text("lease_until"),
  attempts: integer("attempts").notNull().default(0),
  estimatedUnits: integer("estimated_units").notNull().default(0),
  errorCode: text("error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const usage = sqliteTable(
  "usage_ledger",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    estimatedUnits: integer("estimated_units").notNull(),
    confirmedUnits: integer("confirmed_units"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("usage_job").on(t.jobId)],
);
export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  action: text("action").notNull(),
  entityId: text("entity_id").notNull(),
  detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: text("created_at").notNull(),
});

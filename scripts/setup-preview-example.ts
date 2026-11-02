import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { storePhoto } from "../src/server/pipeline";

// Local example preparation only. This script never contacts YouCam or queues jobs.
async function main() {
  const ctx = openDatabase();
  const eventId = "stock-preview-example";
  try {
    if (ctx.db.select().from(s.events).where(eq(s.events.id, eventId)).get()) {
      console.log("Existing stock example kept; no records replaced.");
      return;
    }
    const now = new Date().toISOString();
    const quantities = { XS: 0, S: 3, M: 5, L: 4, XL: 0, XXL: 0 };
    const person = await readFile(".local/samples/person-monstera-6311639.jpg");
    const references = [
      await readFile(".local/samples/shirt-steinke-20669538.jpg"),
      await readFile(".local/samples/shirt-steinke-36392069.jpg"),
    ];
    ctx.sqlite
      .transaction(() => {
        ctx.db
          .insert(s.events)
          .values({
            id: eventId,
            name: "Stock-photo workflow example",
            currency: "EUR",
            budgetMinor: 60000,
            sample: true,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        for (const [index, label, colour, hex] of [
          [0, "Chalk", "White", "#eeeeeb"],
          [1, "Amber", "Orange", "#e98227"],
        ] as const) {
          const id = `stock-team-${index}`;
          ctx.db
            .insert(s.teams)
            .values({
              id,
              eventId,
              name: `${label} Example Team`,
              code: index ? "AMB" : "CHK",
              quantities,
            })
            .run();
          ctx.db
            .insert(s.designs)
            .values({
              id: `stock-design-${index}`,
              eventId,
              name: `${label} stock shirt`,
              colour,
              primaryHex: hex,
              secondaryHex: "#eeeeeb",
              pattern: "solid",
            })
            .run();
          ctx.db
            .insert(s.options)
            .values({
              id: `stock-option-${index}`,
              eventId,
              teamId: id,
              designId: `stock-design-${index}`,
              owned: false,
              unitMinor: index ? 1600 : 1800,
              setupMinor: 0,
              minimumOrder: 0,
              stock: { XS: 20, S: 20, M: 20, L: 20, XL: 20, XXL: 20 },
              available: true,
              illustrative: true,
              seller: "Illustrative order price; stock photo is not a retail listing",
              priceDate: now.slice(0, 10),
            })
            .run();
        }
        ctx.db
          .insert(s.fixtures)
          .values({
            id: "stock-fixture",
            eventId,
            teamA: "stock-team-0",
            teamB: "stock-team-1",
            pairKey: "stock-team-0|stock-team-1",
            label: "Example matchup",
          })
          .run();
      })
      .immediate();
    const upload = async (
      kind: string,
      targetId: string,
      bytes: Buffer,
      name: string,
      basis: string,
    ) => {
      const form = new FormData();
      const revision = ctx.db.select().from(s.events).where(eq(s.events.id, eventId)).get()!
        .revision;
      form.set("eventId", eventId);
      form.set("revision", String(revision));
      form.set("kind", kind);
      form.set("targetId", targetId);
      form.set("permission", "true");
      form.set("adult", "true");
      form.set("basis", basis);
      form.set("photo", new File([Uint8Array.from(bytes)], name, { type: "image/jpeg" }));
      await storePhoto(ctx, form);
    };
    for (let index = 0; index < 2; index++) {
      await upload(
        "person",
        `stock-team-${index}`,
        person,
        "pexels-monstera-6311639.jpg",
        "Pexels License, Monstera Production 6311639. Stock model example; no endorsement or participant claim.",
      );
      await upload(
        "reference",
        `stock-design-${index}`,
        references[index],
        `pexels-steinke-${index ? "36392069" : "20669538"}.jpg`,
        "Pexels License, Dmitriy Steinke. Stock garment reference; illustrative team and order price.",
      );
    }
    console.log(
      "Prepared two licensed stock-photo choices locally. No tasks queued, no photos sent externally.",
    );
    console.log(`http://127.0.0.1:3000/?event=${eventId}`);
  } finally {
    ctx.sqlite.close();
  }
}
main().catch(() => {
  console.error(
    "Could not prepare the local stock example; check that the documented sample files exist.",
  );
  process.exitCode = 1;
});

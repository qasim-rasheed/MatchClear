import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { openDatabase } from "../src/server/db";
import * as s from "../src/server/db/schema";

// Local practice data only. No provider client, uploads, jobs or approvals.
const root = resolve(".local/premier-league-2024-25");
const eventId = "premier-league-2024-25-practice";
const quantities = { XS: 0, S: 2, M: 4, L: 2, XL: 0, XXL: 0 };
const clubs = [
  { id: "arsenal", name: "Arsenal", code: "ARS", model: "adult-model-01.jpg" },
  { id: "liverpool", name: "Liverpool", code: "LIV", model: "adult-model-01.jpg" },
  { id: "chelsea", name: "Chelsea", code: "CHE", model: "adult-model-02.jpg" },
  { id: "tottenham", name: "Tottenham Hotspur", code: "TOT", model: "adult-model-02.jpg" },
];
const shirts = [
  {
    club: "arsenal",
    kind: "home",
    colour: "Red / white",
    hex: "#c90024",
    secondary: "#ffffff",
    pattern: "panel",
    file: "arsenal-home-2024-25.jpg",
    source: "https://www.subside.com.au/adidas-arsenal-home-authentic-shirt-2024-2025",
  },
  {
    club: "liverpool",
    kind: "home",
    colour: "Red / yellow",
    hex: "#c8102e",
    secondary: "#f0d34a",
    pattern: "stripe",
    file: "liverpool-home-2024-25.jpg",
    source: "https://www.subsidesports.com/uk/nike-liverpool-home-shirt-2024-2025",
  },
  {
    club: "liverpool",
    kind: "away",
    colour: "Night forest / teal",
    hex: "#172522",
    secondary: "#42d7c2",
    pattern: "solid",
    file: "liverpool-away-2024-25.jpg",
    source: "https://www.liverpoolfc.com/news/take-closer-look-liverpools-new-nike-away-kit",
  },
  {
    club: "chelsea",
    kind: "home",
    colour: "Blue / orange",
    hex: "#1747b0",
    secondary: "#ed692f",
    pattern: "solid",
    file: "chelsea-home-2024-25.jpg",
    source:
      "https://store.chelseafc.com/en/chelsea-nike-home-stadium-shirt-2024-25/p-130022318301452826+z-8-3421640581",
  },
  {
    club: "tottenham",
    kind: "home",
    colour: "White / navy",
    hex: "#eeeeef",
    secondary: "#12254b",
    pattern: "panel",
    file: "tottenham-home-2024-25.jpg",
    source: "https://www.subside.com.au/nike-tottenham-home-shirt-2024-2025",
  },
];
const fixtures = [
  {
    date: "2024-10-27",
    home: "arsenal",
    away: "liverpool",
    source: "https://www.premierleague.com/en/news/4156035",
  },
  {
    date: "2024-11-10",
    home: "chelsea",
    away: "arsenal",
    source: "https://www.premierleague.com/en/news/4165946",
  },
  {
    date: "2024-12-08",
    home: "tottenham",
    away: "chelsea",
    source:
      "https://www.chelseafc.com/en/match/tottenham-hotspur-vs-chelsea-english-premier-league-2024-12-08?tab=match-news",
  },
  {
    date: "2024-12-22",
    home: "tottenham",
    away: "liverpool",
    source:
      "https://www.liverpoolfc.com/news/liverpool-spend-christmas-four-points-clear-top-after-scoring-six-win-over-tottenham/",
  },
];
const club = (id: string) => clubs.find((c) => c.id === id)!;
const teamId = (id: string) => `pl2425-${id}`;
const designId = (id: string, kind: string) => `pl2425-${id}-${kind}`;
async function main() {
  await mkdir(root, { recursive: true });
  // Read and decode every required file before touching the database.
  for (const file of [
    ...shirts.map((p) => `shirts/${p.file}`),
    "people/adult-model-01.jpg",
    "people/adult-model-02.jpg",
  ]) {
    const meta = await sharp(await readFile(resolve(root, file))).metadata();
    if (
      !["jpeg", "png"].includes(meta.format || "") ||
      Math.min(meta.width || 0, meta.height || 0) < 384
    )
      throw new Error(`Unsupported image: ${file}`);
  }
  await writeFile(
    resolve(root, "teams.csv"),
    "name,code,XS,S,M,L,XL,XXL\n" +
      clubs.map((c) => `${c.name},${c.code},0,2,4,2,0,0`).join("\n") +
      "\n",
  );
  await writeFile(
    resolve(root, "fixtures.csv"),
    "label,team_a,team_b\n" +
      fixtures
        .map(
          (f) =>
            `${f.date}: ${club(f.home).code} vs ${club(f.away).code},${club(f.home).code},${club(f.away).code}`,
        )
        .join("\n") +
      "\n",
  );
  await writeFile(
    resolve(root, "shirt-and-model-map.csv"),
    "team,option,shirt_file,person_file,owned,practice_unit_GBP\n" +
      shirts
        .map(
          (p) =>
            `${club(p.club).name},${p.kind},shirts/${p.file},people/${club(p.club).model},${p.kind === "home"},${p.kind === "home" ? "0" : "35"}`,
        )
        .join("\n") +
      "\n",
  );
  await writeFile(
    resolve(root, "sources.json"),
    JSON.stringify(
      {
        league: "English Premier League",
        season: "2024/25",
        scope: "Four real fixtures; not the complete league or an official kit submission.",
        fixtures,
        shirts,
        people: [
          {
            file: "people/adult-model-01.jpg",
            photographer: "Monstera Production",
            source:
              "https://www.pexels.com/photo/black-man-holding-t-shirt-standing-against-white-background-6311639/",
            license: "https://www.pexels.com/license/",
            note: "Stock adult, not an actual club player; previously tested with two plain shirts.",
          },
          {
            file: "people/adult-model-02.jpg",
            photographer: "Timur Weber",
            source: "https://www.pexels.com/photo/a-man-standing-beside-the-white-wall-9127679/",
            license: "https://www.pexels.com/license/",
            note: "Stock adult, not an actual club player; this pose has not been provider-tested.",
          },
        ],
        assumptions: {
          demandPerClub: quantities,
          budgetGBP: 300,
          homeOptions: "Assumed owned inventory for practice only",
          liverpoolAway:
            "Illustrative replenishment: 8 shirts at GBP 35; not a current retail offer or actual club procurement data",
          images:
            "Club product images retain source rights; downloaded locally at the user's request. No redistribution/public-demo permission is asserted.",
        },
      },
      null,
      2,
    ) + "\n",
  );
  const ctx = openDatabase();
  try {
    if (ctx.db.select().from(s.events).where(eq(s.events.id, eventId)).get()) {
      console.log(
        "Existing Premier League practice event kept. No saved inputs or decisions replaced.",
      );
      return;
    }
    const now = new Date().toISOString();
    ctx.sqlite
      .transaction(() => {
        ctx.db
          .insert(s.events)
          .values({
            id: eventId,
            name: "Premier League 2024/25 — real-fixture practice",
            currency: "GBP",
            budgetMinor: 30000,
            sample: true,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        for (const c of clubs)
          ctx.db
            .insert(s.teams)
            .values({ id: teamId(c.id), eventId, name: c.name, code: c.code, quantities })
            .run();
        for (const p of shirts) {
          const id = designId(p.club, p.kind);
          ctx.db
            .insert(s.designs)
            .values({
              id,
              eventId,
              name: `${club(p.club).name} ${p.kind} 2024/25`,
              colour: p.colour,
              primaryHex: p.hex,
              secondaryHex: p.secondary,
              pattern: p.pattern,
            })
            .run();
          ctx.db
            .insert(s.options)
            .values({
              id: `option-${id}`,
              eventId,
              teamId: teamId(p.club),
              designId: id,
              owned: p.kind === "home",
              unitMinor: p.kind === "home" ? 0 : 3500,
              setupMinor: 0,
              minimumOrder: 0,
              stock: quantities,
              available: true,
              seller:
                p.kind === "home"
                  ? "Practice assumption: club already owns 8 shirts"
                  : "Practice quote only: 8 replenishment shirts at GBP 35; not a retailer offer",
              priceDate: "2026-10-30",
              illustrative: true,
            })
            .run();
        }
        for (const [i, f] of fixtures.entries())
          ctx.db
            .insert(s.fixtures)
            .values({
              id: `pl2425-fixture-${i + 1}`,
              eventId,
              teamA: teamId(f.home),
              teamB: teamId(f.away),
              pairKey: [teamId(f.home), teamId(f.away)].sort().join("|"),
              label: `${f.date}: ${club(f.home).code} vs ${club(f.away).code}`,
            })
            .run();
        ctx.db
          .insert(s.activity)
          .values({
            id: crypto.randomUUID(),
            eventId,
            action: "sample.created",
            entityId: eventId,
            detail: {
              note: "Real 2024/25 clubs and four sourced fixtures. Practice quantities, budget and replenishment price. Photo files are local; the user uploads and confirms their permitted use. No jobs, generated outputs or approvals created.",
            },
            createdAt: now,
          })
          .run();
      })
      .immediate();
    console.log(
      "Created 4 real clubs, 4 verified fixtures and 5 shirt choices. Photos remain in the local kit for manual upload. No API calls or jobs.",
    );
  } finally {
    ctx.sqlite.close();
  }
  console.log(`http://127.0.0.1:3000/?event=${eventId}`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Could not prepare the practice event.");
  process.exitCode = 1;
});

# MatchClear

**Choose team shirts that work together before ordering.**

MatchClear is a web app for organizers of small football tournaments. It brings shirt choices, on-person previews, matchup reviews and purchasing constraints into one workspace, ending with a brief the organizer can send to a seller.

Built for the YouCam API Skin AI & eCommerce VTO Hackathon.

## How it works

1. **Event:** add teams, sizes, quantities, fixtures and a budget.
2. **Shirts:** add existing shirts and purchase options, with prices and availability.
3. **Preview:** use YouCam Clothes Virtual Try-On to see a shirt on a person. Check the result against the original and mark the shirt area.
4. **Compare:** inspect opposing shirts in ordinary, grayscale and six colour-vision screening views. Save a human review and its reason.
5. **Plan & order:** find a complete selection that respects the recorded reviews, sizes, stock, fixed choices and budget. Confirm it and export a frozen seller brief as printable HTML/PDF, CSV or JSON.

The floating assistant suggests relevant next actions. It can prepare tournament changes and planning requests for review before applying them.

## Run locally

Requires **Node.js 22.13 or newer** and npm.

```bash
git clone https://github.com/qasim-rasheed/MatchClear.git
cd MatchClear
npm ci
```

Copy `.env.example` to `.env.local` and fill in the keys you need:

```dotenv
YOUCAM_API_KEY=your_youcam_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

The YouCam key enables new renders. OpenRouter is optional and enables text requests needing AI interpretation; navigation and contextual suggestions work locally. Keys stay on the server.

Initialize the local workspace and start the frontend:

```bash
npm run db:seed
npm run dev
```

In a **second terminal**, from the same directory:

```bash
npm run worker
```

Open [MatchClear locally](http://127.0.0.1:3000). Keep both terminals running for preview generation and planning.

Data and private uploads are saved in ignored `.local/`. Seeding does not replace an existing workspace. A fresh checkout does not include the creator's saved tournament, private renders or API keys.

## Try an example

[Premier League sample pack](examples/premier-league-2024-25/README.md) includes team and fixture CSVs, a shirt checklist, source links and licensed stock model photos. Its guide walks through creating a new event yourself.

The app also has a [built-in planning example](http://127.0.0.1:3000/proof) that uses illustrative data and no API units. It demonstrates how one shirt change affects connected matches.

## Where YouCam is used

The **YouCam Clothes V3 API** receives a permitted person photo and garment reference and generates an on-person appearance preview. The app saves background-job progress, reuses identical completed previews, and lets a reviewer reject inaccurate results.

Accepted previews and confirmed shirt outlines become evidence for matchup reviews. The planner requires current reviews; a successful render alone does not approve a combination. Changing the supporting inputs makes dependent decisions outdated.

New generation uses your YouCam units. The local unit allowance defaults to 40 estimated units and can be configured in `.env.local`; it is not the provider's account balance.

## Checks

```bash
npm test
npm run typecheck
npm run build
npm run evidence:benchmark
```

These checks do not submit provider requests. The committed [planner benchmark](evidence/planner-benchmark.json) compares 500 synthetic cases against independent enumeration; it is software evidence, not user research.

## Project guide

- [Integration and architecture](docs/INTEGRATION.md)
- [Colour-vision views and their limits](docs/COLOR_VIEWS.md)
- [Project description](submission/DESCRIPTION.md)
- [Usefulness demonstration and evidence](submission/USEFULNESS.md)

The app uses Next.js, React, TypeScript, SQLite/Drizzle, Sharp and a separate local worker. Source is in `src/`, database migrations in `migrations/`, and automated checks in `tests/`.

## Scope

Previews show appearance, not guaranteed fit or physical colour accuracy. The screening views support human review; they do not certify pitch visibility or accessibility. The prototype selects one shirt per team across the supplied fixtures. It exports an order specification and does not place purchases.

This is a solo-built prototype. External organizer research and on-field validation have not been completed.

## License

Application code: [MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) and the sample pack's credits for separately licensed material.

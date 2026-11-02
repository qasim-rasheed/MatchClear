# MatchClear

Help tournament organizers choose team shirts that are easier to tell apart, including for colour-blind players and fans.

MatchClear combines YouCam Clothes Virtual Try-On, recorded review of opposing shirt combinations, and tournament-wide shirt selection under a budget.

## Project status

The local application now includes steps 1–14 and the technical testing portion of step 15: organizer setup, durable YouCam previews, appearance acceptance, shirt outlines, screening views, attributed matchup decisions, tournament planning, confirmation and frozen order briefs, a validated text helper, photo cleanup and verified backup/restore. Broader garment evaluation and actual target-user research remain outstanding. No deployment is included.

See [steps 11–15 usage and verification](PHASE_11_15.md) and the [product evaluation protocol](EVALUATION.md).

The complete development sequence is in [the implementation plan](docs/IMPLEMENTATION_PLAN.md). See [baseline progress](docs/BASELINE_PROGRESS.md), [architecture](docs/ARCHITECTURE.md), [product brief](docs/PRODUCT_BRIEF.md), [research materials](docs/USER_RESEARCH.md) and [asset credits](docs/ASSET_REGISTER.md).

## Run locally

- Use Node.js 22.13 or later (Node 22 LTS was used for the baseline).
- Run `npm ci`.
- Copy `.env.example` to `.env.local`. Add `YOUCAM_API_KEY` there, never to a tracked file.
- Run `npm run db:seed` to apply migrations and create the illustrative starter if the database is empty.
- Run `npm run dev` and open http://127.0.0.1:3000 .
- Run `npm run worker` in another terminal. It processes queued preview and planning jobs; generating a preview explicitly authorizes sending its selected photos to YouCam and reserves an estimated two units.
- To process planning jobs without uploads or render submissions, use `npm run worker -- --plans-only` instead.
- Run `npm test`, `npm run typecheck` and `npm run build` for local checks.

The database and private files live in ignored `.local`. Seeding never replaces an existing workspace. Setup, saved reviews and planning work without an API key; new YouCam renders require one. The unit ledger is conservative, not account billing. The default global allowance is 40 estimated units.

## Use the new flow

1. In **Preview Studio**, choose a team and assigned shirt. Save a permitted adult-person photo and a front-facing garment photograph. Catalog drawings cannot serve as photographic references.
2. Confirm permission to send the two photos to YouCam, then generate. The worker saves task progress; leaving the page does not lose the job. Identical completed inputs are reused.
3. Inspect the source, reference and output. Accept or reject the appearance with notes. For an accepted output, mark and confirm the shirt outline.
4. In **Matchup Review**, choose the opposing options. Inspect ordinary, grayscale, protan and deutan views, and check original references. Record approval, rejection or inconclusive with a reviewer and reason. These are screen-review decisions, not physical accessibility certificates.
5. In **Tournament Plan**, set starting choices and optional locks, then run planning. It uses recorded stock, size quantities, allocated minimum-order extras, budget and current approvals. Missing evidence produces an incomplete result; impossible conditions produce no valid plan.
6. Check the consequences for each fixture and any proposed changes. Confirm a complete current plan with your name/initials, then continue to **Order Brief**.
7. Create the brief with or without generated person previews (excluded by default). Open the printable HTML and use its **Print / Save as PDF** button, or download CSV/JSON. This creates an order specification; it does not buy shirts.

Optional: add `OPENROUTER_API_KEY` to `.env.local` and use **Text Assistant**. It uses the fixed free `nvidia/nemotron-3.5-super-vl:free` model. Read the text-sharing notice, prepare a budget/fixture/lock draft, review the exact edits and explicitly apply them. It cannot approve visual combinations. Forms remain available when the provider fails or reaches its limits. Automatic retries and paid-model fallbacks are disabled.

Changing a photo, design, acceptance or outline invalidates affected visual evidence. Price, stock and budget changes invalidate planning results. Old results remain visible and labeled outdated.

See [steps 8–10 usage and limits](docs/PHASE_8_10.md) and [verification](docs/VERIFICATION.md).

## Explicit YouCam feasibility test

- Set your permitted person/garment file paths and permission confirmation in `.env.local`.
- Run `npm run youcam:check -- --dry-run` to validate input preparation without provider calls.
- Run `npm run youcam:check` to submit one V3 upper-body test.
- The downloaded licensed inputs documented in the asset register can be used with `npm run youcam:check -- --sample` on this checkout.
- A completed identical pair is reused; a known running task resumes status checks. An uncertain submission is not automatically repeated.
- Consumption is conservatively estimated, not read from an account billing API. The default feasibility allowance is 40 units.
- Sample downloads and results are private local development files and are not included in Git. Other contributors supply their own permitted files.

## CSV input

- Team headers: `name,code,XS,S,M,L,XL,XXL`.
- Fixture headers: `label,team_a,team_b`; use saved team short codes for the two teams.
- Use Import CSV on Teams or Fixtures, review the rows and confirm.
- If any row is invalid or conflicts with existing data, the whole batch is rejected without partial changes.

## Important product boundaries

Generated images are appearance previews. Colour-vision model views support review and do not certify physical kit visibility, exact colour or fit. Planning results depend on recorded human approvals and declared availability/costs.

## Credentials

Keep real credentials in local environment files and hosting environment settings. Never commit or paste them into project documentation. The YouCam API key belongs on the server.

## License

[MIT](LICENSE).

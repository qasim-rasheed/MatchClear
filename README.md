# MatchClear

Help tournament organizers choose team shirts that are easier to tell apart, including for colour-blind players and fans.

MatchClear combines YouCam Clothes Virtual Try-On, recorded review of opposing shirt combinations, and tournament-wide shirt selection under a budget.

## Project status

Chat steps 1–10 are implemented locally: organizer setup, permitted photo inputs, durable YouCam previews, appearance acceptance, editable shirt outlines, four screening views, attributed matchup decisions and tournament planning. Three real V3 renders have succeeded in total, including two stock-photo workflow tests. Order exports, broader garment evaluation and target-user research remain future work. No deployment is included.

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

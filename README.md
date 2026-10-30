# MatchClear

Help tournament organizers choose team shirts that are easier to tell apart, including for colour-blind players and fans.

MatchClear is a planned web application combining YouCam Clothes Virtual Try-On, human review of opposing shirt combinations, and tournament-wide shirt selection under a budget.

## Project status

The local baseline is implemented through organizer setup: events, teams, size quantities, fixtures, shirt illustrations, price/stock records and reviewed CSV imports. Data persists in SQLite. One real YouCam V3 feasibility render has succeeded; the full preview studio, visual screening, planner and exports are later steps. No user study or deployment is complete.

The complete development sequence is in [the implementation plan](docs/IMPLEMENTATION_PLAN.md). See [baseline progress](docs/BASELINE_PROGRESS.md), [architecture](docs/ARCHITECTURE.md), [product brief](docs/PRODUCT_BRIEF.md), [research materials](docs/USER_RESEARCH.md) and [asset credits](docs/ASSET_REGISTER.md).

## Run locally

- Use Node.js 22.13 or later (Node 22 LTS was used for the baseline).
- Run `npm ci`.
- Copy `.env.example` to `.env.local`. Add `YOUCAM_API_KEY` there, never to a tracked file.
- Run `npm run db:seed` to apply migrations and create the illustrative starter if the database is empty.
- Run `npm run dev` and open http://127.0.0.1:3000 .
- Run `npm run worker` in another terminal for the baseline healthcheck worker. It does not submit renders automatically.
- Run `npm test`, `npm run typecheck` and `npm run build` for local checks.

The database and private files live in ignored `.local`. Seeding never replaces an existing workspace. Development works without an API key; only the explicitly invoked provider test requires one.

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

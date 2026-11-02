# MatchClear

**Tagline:** Preview team shirts and plan the whole tournament before ordering.

## The problem and the user

MatchClear is for the organizer of a small tournament who has to choose team shirts, reuse what teams already own and stay within a budget. A choice that works for one fixture can create a problem in another. The organizer needs one complete selection and a clear specification to give a seller.

[IFAB Law 4](https://theifab.com/laws/latest/the-players-equipment/) establishes the need for distinguishable team colours in football. MatchClear supports a pre-order review process; its shirt-only screen previews do not certify full-kit compliance or field recognition.

## What the working application does

The organizer enters teams, sizes, shirt options, inventory, prices and fixtures. YouCam Clothes V3 creates on-person appearance previews from permitted person and garment photographs. The organizer checks whether each output represents the shirt well, confirms a shirt area and compares opposing combinations in eight views: ordinary, grayscale and complete/partial protan, deutan and tritan screening. Partial settings are representative examples; partial tritan is an interpolation approximation. They record approval, rejection or an inconclusive decision with a reason.

A tournament-wide planner then chooses one shirt per team using current approved combinations, the total budget, size quantities, stock, setup charges, minimum-order allocations and fixed choices. It minimizes recorded cost, then changes among equal-cost plans. Missing evidence never becomes an approval. The organizer confirms a complete plan and exports a frozen order brief with designs, sizes, quantities, sources, costs and review notes. Person previews are excluded by default.

## Why the YouCam integration matters

The API supplies the on-person appearance evidence the organizer reviews. A rejected or outdated render cannot silently keep an old approval valid. Changing the source garment, person, accepted appearance or shirt outline invalidates the related evidence. The generated result is therefore part of the recorded decision chain, rather than a decorative image beside an unrelated recommendation.

The practical question is whether that extra on-person context improves real decisions. This solo prototype does not claim to have established that with participants or on a playing field.

## Demonstrated technical work

- Server-side YouCam file registration, signed uploads, upper-body Clothes V3 tasks, polling and private result storage.
- Persisted background jobs, duplicate reuse, known-task recovery and uncertain-submission handling.
- Versioned appearance, outline and review evidence; outdated approvals cannot produce a current complete plan.
- Exact bounded planning, with explicit incomplete, infeasible and search-limit states.
- Frozen HTML/CSV/JSON briefs, spreadsheet-formula protection and opt-in person imagery.
- Local deletion retries and checksummed backup/restore with unfinished jobs held after restoration.
- An optional text-only Nemotron assistant through OpenRouter for validated draft edits and explanations grounded in saved planner facts.

## Evidence

The working local example contains real saved YouCam results from licensed stock inputs and a reviewed two-team plan through order-brief creation. These are developer walkthroughs, not participant findings.

The separate four-team teaching example demonstrates a local fix moving a conflict to another match, followed by a complete selection. Its supplied decisions and prices are explicitly synthetic.

In a reproducible benchmark, all **500 seeded four-team cases** matched an independent exhaustive enumerator for minimum cost and equal-cost change counts. There were **207 feasible cases**, **293 infeasible cases**, and **zero returned selections violating the tested budget, locks or pair decisions**. This measures planner correctness, not user benefit or real purchasing savings.

## Built with

Next.js, React, TypeScript, SQLite, Drizzle, Sharp, browser Canvas, Vitest, YouCam Clothes V3 and optional Nemotron through OpenRouter.

## Current limits

One fixed shirt per team; local single-organizer workspace; supplied rather than live retailer inventory. Generated images are appearance previews, not fit guarantees or exact physical colour measurements. Screening transforms and developer decisions do not certify accessibility. Broader garment evaluation and external organizer/player/seller research remain future work. No deployment is included.

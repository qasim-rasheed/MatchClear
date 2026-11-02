# What the prototype shows about usefulness

## A specific job and a usable output

The intended user is an organizer selecting one fixed shirt per team for a small tournament. The job is to turn separate team preferences, visual review decisions and purchasing constraints into a complete event plan and a seller-ready brief.

This is a product hypothesis supported by a functioning workflow, not a demonstrated market-demand finding.

## External problem context

[IFAB Law 4, section 3](https://theifab.com/laws/latest/the-players-equipment/) requires opposing teams to be visually distinguishable from each other and match officials. That provides a concrete football reason to review kit choices before matches. It does not establish that this app or virtual try-on improves those choices. MatchClear's current shirt-only prototype does not assess the full kit, goalkeeper or official colours, and does not certify rule compliance.

For a simple event, a manual checklist, spare shirts or bibs may be sufficient. The demonstrated use case is an event with several connected fixtures, alternative shirts and purchasing constraints; owned alternatives are included so buying new shirts is not assumed to be the answer.

## Concrete four-team example

This is a **synthetic example**, with 12 shirts per team, illustrative costs and explicitly supplied opposing-pair decisions. The colours do not automatically determine approval in the real product.

| Selection | Cost | Supplied unresolved fixtures | What it demonstrates |
| --- | ---: | ---: | --- |
| All starting owned shirts | €0 | 1 | The supplied Northbank/Parkside combination needs changing. |
| Buy navy for Parkside | €144 | 1 | The first fixture is fixed but the next fixture is rejected. |
| Buy white for Northbank; use Old Town's owned navy spare | €216 | 0 | A complete solution needs connected decisions, including an owned alternative. |
| Keep Old Town white under the same €300 budget | No valid plan | — | The constraints cannot all be satisfied; the planner must explain this. |
| Keep Old Town white and allow €500 | €444 | 0 | The lock has a cost: Parkside's €144 change plus Riverside's €300 alternative. |

These are calculated consequences of this input, not money saved by a real customer. Open `/proof`, switch stages and toggle the fixed-shirt condition to reproduce them. The example runs the production solver but never writes synthetic approvals into the real event database.

## What YouCam adds, and what remains to establish

The real saved stock examples let a reviewer inspect the garment on a person rather than only on a hanger. The workflow can reject a poor rendering, preserve the original for comparison and attach a decision to the accepted output and selected shirt area. Altering that evidence invalidates the dependent decision.

That proves the integration and evidence dependency. It does **not** prove that previews produce better choices than product references alone. No participant comparison or actual-wear benchmark is claimed.

## Reproducible software evidence

Run `npm run evidence:benchmark`. The committed report is `evidence/planner-benchmark.json`, seed 2193, 500 four-team cases with two choices per team and four fixtures per case. Every complete combination is independently enumerated to check minimum cost and then changes from the starting choices. Budget and fixed-choice conditions vary.

Recorded result: 500/500 matched; 207 feasible; 293 infeasible; zero returned selections violating the tested constraints. Tests also cover stale approvals, missing evidence, frozen exports and provider recovery. These are correctness measurements, not surveys, field tests or conversion metrics.

## Why a seller can use the output

The brief specifies design IDs and reference images, team names, requested and extra sizes, quantities, source information and declared charges. It freezes the confirmed information instead of changing an old order specification when a price is edited. It does not place an order or confirm live supplier stock.

## Honest statement for judging

“I built and tested this as a solo developer. I can demonstrate real YouCam previews, versioned review evidence, a complete planning workflow and frozen order specifications. I also published a reproducible solver benchmark. I have not yet validated organizer demand, preview decision benefit or field accessibility with external participants.”

## Builder walkthrough record

To add your own actual observations, complete the journey yourself and record the date, event, where you got stuck, whether the preview changed a decision, and whether the brief contains enough information to request a quote. Describe this as one builder walkthrough. Do not convert it into an external-user study or invent participant results.

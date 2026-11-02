import type { BriefSnapshot } from "./orders";
export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function briefCsv(brief: BriefSnapshot) {
  const sizes = ["XS", "S", "M", "L", "XL", "XXL"];
  const header = [
    "team",
    "design_id",
    "design",
    "owned",
    ...sizes.map((s) => `requested_${s}`),
    ...sizes.map((s) => `extra_${s}`),
    "order_quantity",
    "unit_minor",
    "setup_minor",
    "line_total_minor",
    "currency",
    "seller",
    "information_date",
    "illustrative",
    "confirmed_by",
    "confirmed_at",
  ];
  return (
    "\uFEFF" +
    [
      header,
      ...brief.lines.map((l) => [
        l.team,
        l.designId,
        l.design,
        l.owned,
        ...sizes.map((s) => l.quantities[s] || 0),
        ...sizes.map((s) => l.extras[s] || 0),
        l.orderQuantity,
        l.unitMinor,
        l.setupMinor,
        l.totalMinor,
        brief.event.currency,
        l.seller,
        l.priceDate,
        l.illustrative,
        brief.confirmedBy,
        brief.confirmedAt,
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
export function briefHtml(
  brief: BriefSnapshot,
  images: Record<string, string>,
  outdated: boolean,
  nonce: string,
) {
  const e = escapeHtml;
  const money = (minor: number) =>
    e(
      new Intl.NumberFormat("en", { style: "currency", currency: brief.event.currency }).format(
        minor / 100,
      ),
    );
  const photo = (id: string | undefined, label: string) =>
    id && images[id]
      ? `<img src="${images[id]}" alt="${e(label)}">`
      : `<p class="muted">${e(label)} unavailable or locally deleted.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MatchClear order brief — ${e(brief.event.name)}</title><style>
body{font:15px/1.6 system-ui,sans-serif;color:#24342d;background:#f7f8f3;margin:0}main{max-width:960px;margin:auto;padding:36px}header,article,section{margin-bottom:26px}article{border-top:1px solid #b8c2b8;padding-top:20px;break-inside:avoid}h1{font-size:32px;line-height:1.2}h2{font-size:22px}h3{font-size:18px}img{width:180px;height:210px;object-fit:contain;margin-right:15px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border-bottom:1px solid #cdd3ca;padding:8px;vertical-align:top}small,.muted{color:#526256}button{padding:12px 18px;background:#253f32;color:white;border:0;border-radius:4px;cursor:pointer}.warning{padding:15px;border:2px solid #8f422c}.total{font-size:27px}.limits{border-top:1px solid #aaa;padding-top:20px}@media print{body{background:white}main{padding:0}button{display:none}img{max-height:170px}a{color:inherit}}
</style></head><body><main><button id="print">Print / Save as PDF</button><header><p>MatchClear · frozen order brief</p><h1>${e(brief.event.name)}</h1><p>Confirmed by ${e(brief.confirmedBy)} · ${e(brief.confirmedAt)}<br>Plan ${e(brief.planId)} · ${e(brief.optimality)} among recorded approved combinations</p>${outdated ? '<p class="warning">Historical brief: event inputs changed after this plan. Reconfirm current information before ordering.</p>' : ""}<p class="total">Total ${money(brief.totalMinor)} / budget ${money(brief.event.budgetMinor)}</p><p>${brief.includePlayerPhotos ? "Includes generated person previews." : "Player photos and generated person previews excluded."}</p></header>
${brief.lines.map((l) => `<article><h2>${e(l.team)} — ${e(l.design)}</h2><p>Design ID: ${e(l.designId)} · ${l.owned ? "Already owned" : "New purchase"}${l.illustrative ? " · Illustrative inventory/price" : ""}</p>${photo(l.referenceAssetId, "Original garment reference")}${brief.includePlayerPhotos ? photo(l.previewAssetId, "Generated appearance preview") : ""}<table><thead><tr><th>Size</th><th>Requested</th><th>Extra units</th><th>Total</th></tr></thead><tbody>${["XS", "S", "M", "L", "XL", "XXL"].map((size) => `<tr><td>${size}</td><td>${l.quantities[size] || 0}</td><td>${l.extras[size] || 0}</td><td>${(l.quantities[size] || 0) + (l.extras[size] || 0)}</td></tr>`).join("")}</tbody></table><p>${l.orderQuantity} shirts · unit ${money(l.unitMinor)} · setup ${money(l.setupMinor)} · line total <strong>${money(l.totalMinor)}</strong></p><p>Seller/source: ${e(l.seller)}<br>Information checked: ${e(l.priceDate)}</p></article>`).join("")}
<section><h2>Supporting screen reviews</h2>${brief.fixtures.map((f) => `<article><h3>${e(f.label)}</h3><p>${e(f.teamA)}: ${e(f.designA)}<br>${e(f.teamB)}: ${e(f.designB)}</p><p>Approved by ${e(f.reviewer)} · ${e(f.reviewedAt)}<br>${e(f.reason)}</p><small>Review ${e(f.reviewId)}</small></article>`).join("")}</section><section class="limits"><h2>Limits and checks before ordering</h2><ul>${brief.limitations.map((l) => `<li>${e(l)}</li>`).join("")}</ul><p>Frozen values do not change after export. Deleted local photos are not restored into this document.</p></section></main><script nonce="${nonce}">document.getElementById('print').addEventListener('click',()=>window.print());</script></body></html>`;
}

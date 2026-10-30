import { sizeKeys } from "./validation";

export type CsvPreview = { headers: string[]; rows: Record<string, string>[]; errors: string[] };
export function parseCsv(input: string): CsvPreview {
  if (input.length > 50_000)
    return { headers: [], rows: [], errors: ["Use a CSV smaller than 50 KB."] };
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  const errors: string[] = [];
  const source = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else field += char;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(field.trim());
      field = "";
      afterQuote = false;
      if (char !== ",") {
        if (row.some(Boolean)) matrix.push(row);
        row = [];
        if (char === "\r" && source[i + 1] === "\n") i++;
      }
    } else if (char === '"') {
      if (field || afterQuote) errors.push(`Unexpected quote near line ${matrix.length + 1}.`);
      quoted = true;
    } else {
      if (afterQuote && char.trim())
        errors.push(`Unexpected text after a quoted field near line ${matrix.length + 1}.`);
      field += char;
    }
  }
  if (quoted) errors.push("A quoted field is not closed.");
  if (field || row.length) {
    row.push(field.trim());
    if (row.some(Boolean)) matrix.push(row);
  }
  const headers = matrix.shift() || [];
  if (!headers.length) errors.push("Add a header row first.");
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
    errors.push("Headers must be non-empty and unique.");
  if (matrix.length > 100) errors.push("Import at most 100 rows at a time.");
  const rows = matrix.slice(0, 100).map((cells, i) => {
    if (cells.length !== headers.length)
      errors.push(`Row ${i + 2}: expected ${headers.length} columns, found ${cells.length}.`);
    return Object.fromEntries(headers.map((header, j) => [header, cells[j] || ""]));
  });
  if (!rows.length) errors.push("Add at least one data row.");
  return { headers, rows, errors: [...new Set(errors)] };
}
export const teamCsvExample =
  "name,code,XS,S,M,L,XL,XXL\nEastfield FC,EFC,0,3,5,4,0,0\nWestbridge Athletic,WBA,0,4,4,4,0,0";
export const fixtureCsvExample = "label,team_a,team_b\nMatch 1,EFC,WBA";
export function checkCsvColumns(kind: "teams" | "fixtures", headers: string[]) {
  const required = kind === "teams" ? ["name", "code", ...sizeKeys] : ["label", "team_a", "team_b"];
  return required.filter((k) => !headers.includes(k)).map((k) => `Missing column: ${k}`);
}
export function checkCsvRows(kind: "teams" | "fixtures", rows: Record<string, string>[]) {
  const errors: string[] = [];
  const seenNames = new Set<string>();
  const seenCodes = new Set<string>();
  rows.forEach((row, i) => {
    const line = i + 2;
    if (kind === "teams") {
      if ((row.name || "").trim().length < 2 || row.name.length > 80)
        errors.push(`Row ${line}: team name must have 2–80 characters.`);
      if (!/^[A-Za-z0-9]{2,4}$/.test(row.code || ""))
        errors.push(`Row ${line}: use a 2–4 character team code.`);
      if (
        seenNames.has((row.name || "").toLowerCase()) ||
        seenCodes.has((row.code || "").toLowerCase())
      )
        errors.push(`Row ${line}: duplicate team name or code in this file.`);
      seenNames.add((row.name || "").toLowerCase());
      seenCodes.add((row.code || "").toLowerCase());
      for (const size of sizeKeys)
        if (!/^\d+$/.test(row[size] || "") || Number(row[size]) > 1000)
          errors.push(`Row ${line}: ${size} must be a whole number from 0 to 1000.`);
      if (!sizeKeys.some((size) => Number(row[size]) > 0))
        errors.push(`Row ${line}: add at least one shirt.`);
    } else {
      if ((row.label || "").length < 2 || row.label.length > 80)
        errors.push(`Row ${line}: fixture label must have 2–80 characters.`);
      if (!row.team_a || !row.team_b || row.team_a.toLowerCase() === row.team_b.toLowerCase())
        errors.push(`Row ${line}: use two different team codes.`);
    }
  });
  return errors;
}

/**
 * CSV read/write for imports and exports.
 *
 * parseCsv is a small RFC 4180 parser (quoted fields, escaped quotes,
 * embedded commas and newlines, CRLF, UTF-8 BOM) with delimiter
 * detection for comma / semicolon / tab — Excel in many locales saves
 * "CSV" with semicolons.
 *
 * toCsv neutralises spreadsheet formula injection: a text cell that
 * starts with = + - @ (or tab / CR) is prefixed with an apostrophe so
 * Excel, LibreOffice and Google Sheets show it as text instead of
 * executing it (OWASP "CSV Injection").
 */

export type CsvDelimiter = "," | ";" | "\t";

export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  let best: CsvDelimiter = ",";
  let bestCount = -1;
  for (const d of [",", ";", "\t"] as const) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Parse CSV text into rows of raw string cells. Blank lines are dropped. */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0].trim() === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** Escape one text cell for CSV, including formula-injection defence. */
export function escapeCsvText(value: string): string {
  let v = value;
  if (FORMULA_TRIGGER.test(v)) v = `'${v}`;
  if (/[",\n\r;\t]/.test(v) || v !== v.trim()) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export type CsvCell = string | number | null | undefined;

/**
 * Serialise rows. Numbers we generated ourselves are written raw (so
 * spreadsheets can sum them); every string goes through escapeCsvText.
 */
export function toCsv(rows: CsvCell[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          if (cell === null || cell === undefined) return "";
          if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
          return escapeCsvText(cell);
        })
        .join(","),
    )
    .join("\r\n");
}

/** Browser download with a UTF-8 BOM so Excel renders ₹ and Hindi text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { describe, expect, it } from "vitest";
import { detectDelimiter, escapeCsvText, parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas and newlines, CRLF and BOM", () => {
    const text = '\uFEFFname,amount,notes\r\n"Sharma Traders, Delhi","1,23,456.50","He said ""soon""\nnext line"\r\nGupta,500,\r\n';
    expect(parseCsv(text)).toEqual([
      ["name", "amount", "notes"],
      ["Sharma Traders, Delhi", "1,23,456.50", 'He said "soon"\nnext line'],
      ["Gupta", "500", ""],
    ]);
  });

  it("keeps apostrophes and drops blank lines", () => {
    expect(parseCsv("a,b\n\nO'Brien,1\n")).toEqual([
      ["a", "b"],
      ["O'Brien", "1"],
    ]);
  });

  it("detects semicolon and tab delimited exports", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv('a;b\n"x;y";2')).toEqual([
      ["a", "b"],
      ["x;y", "2"],
    ]);
  });
});

describe("toCsv formula-injection defence", () => {
  it.each(["=HYPERLINK(\"http://evil\")", "+SUM(A1:A9)", "-2+3", "@cmd", "\t=1", "\r=1"])(
    "neutralises %j so spreadsheets show it as text",
    (payload) => {
      const out = escapeCsvText(payload);
      const unquoted = out.startsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
      expect(unquoted.startsWith("'")).toBe(true);
    },
  );

  it("leaves normal text and numbers alone and quotes when needed", () => {
    expect(toCsv([["Sharma, Delhi", 12345.5, null, "plain"]])).toBe('"Sharma, Delhi",12345.5,,plain');
  });

  it("round-trips through the parser", () => {
    const rows = [["a,b", 'q"uote', "line\nbreak", "=1+1"]];
    expect(parseCsv(toCsv(rows))).toEqual([["a,b", 'q"uote', "line\nbreak", "'=1+1"]]);
  });
});

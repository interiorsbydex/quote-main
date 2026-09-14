import assert from "node:assert/strict";
import { parseTabRows } from "../server/catalog-sync";
import { DEFAULT_SHEET_TABS } from "../server/pricing-versions";

const handles = DEFAULT_SHEET_TABS.find((tab) => tab.sheetTabId === 1863704353);
assert(handles, "Handles tab configuration is missing");
for (const gid of [1433198119, 1293380484, 994463430]) {
  assert.equal(DEFAULT_SHEET_TABS.find((tab) => tab.sheetTabId === gid)?.enabled, true);
}

const headers = [
  "Project Type",
  "Services Type ",
  "Work Type",
  "Product Code ",
  "Available Finishes",
  "Dimension",
  "Brand",
  "Product image ",
  "Description",
  "Rates ",
  "",
  "",
  "",
  "Item Code",
];

const image = "https://drive.google.com/file/d/1jVlV63Col6Nh6DOshXpfHSwTzg1O-4n9/view?usp=drive_link";
const row = [
  "Xpress, Xpand, Xclusive",
  "Civil Services",
  "AL 02",
  "Cabinet handle",
  "SS Brush, Black, Matt Rose Gold",
  "96mm",
  "4G",
  image,
  "Cabinet Handle AL-02",
  844,
  "",
  "",
  "",
  "HDL-0001",
];

const parsed = parseTabRows(
  handles as any,
  "DeX - Handles",
  [row],
  { syncLogId: null, pricingVersionId: "test-version" },
  headers,
);

assert.equal(parsed.items.length, 1);
assert.equal(parsed.errors.length, 0);
assert.equal(parsed.items[0].brand, "4G");
assert.deepEqual(parsed.items[0].finishes, ["SS Brush", "Black", "Matt Rose Gold"]);
assert.equal(parsed.items[0].unitType, "Cabinet handle");
assert.equal(parsed.items[0].rate, 844);
assert.equal(parsed.items[0].sellingPrice, 844);
assert.equal(parsed.items[0].itemCode, "HDL-0001");
assert.match(parsed.items[0].imageUrl ?? "", /^https:\/\/drive\.google\.com\/thumbnail\?/);

const missingRateHeader = parseTabRows(
  handles as any,
  "DeX - Handles",
  [row],
  { syncLogId: null, pricingVersionId: "test-version" },
  headers.map((header) => header === "Rates " ? "Cost" : header),
);
assert.equal(missingRateHeader.items.length, 0);
assert.equal(missingRateHeader.errors[0]?.severity, "error");
assert.match(missingRateHeader.errors[0]?.message ?? "", /Required column\(s\) missing: rates/);

const xpress = DEFAULT_SHEET_TABS.find((tab) => tab.sheetTabId === 1463070649);
assert(xpress, "Xpress tab configuration is missing");
const xpressRow = [
  "Xpress", "Modular Work", "Dry / Inexposed", "Base Storage", "", "",
  "MR Ply", "DeX", "Base Storage Unit", 2552, "", "", "", "XPR-0002",
];
const parsedXpress = parseTabRows(
  xpress as any,
  "DeX - Xpress",
  [xpressRow],
  { syncLogId: null, pricingVersionId: "test-version" },
  [],
);
assert.equal(parsedXpress.items[0].rate, 2552);
assert.equal(parsedXpress.items[0].sellingPrice, 0);

console.log("PASS Handles header mapping");
console.log("PASS malformed Handles header rejection");
console.log("PASS Xpress rate fallback mapping");
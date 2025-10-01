// scraper.js
import { chromium } from "@playwright/test";
import fs from "fs";
import Papa from "papaparse";

const START_URL = "https://www.ccilindia.com/market-watch";

// Only 3 tabs to save time (add WI / OddLot later if needed)
const TABS = [
  { labels: ["CG Mkt. Watch","Central Government","G-Sec"], segment: "Central Government Market Watch" },
  { labels: ["SG Mkt. Watch","State Government","SDL"], segment: "State Government Market Watch" },
  { labels: ["T-Bills Mkt. Watch","T Bills","Treasury Bills"], segment: "T-Bills Market Watch" }
];

const OUT_DIR = "docs/data";

// Helper: clean filename
function slug(s) {
  return (s||"").toLowerCase().replace(/\s+/g,"_").replace(/[^\w_]/g,"");
}

// Click element by text
async function clickByText(page, texts) {
  for (const t of texts) {
    const el = page.locator(`text=${t}`).first();
    if (await el.count()) {
      await el.click();
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

// Extract table rows
async function extractTable(page) {
  return await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table.dataTable tbody tr"));
    return rows.map(r => Array.from(r.querySelectorAll("td")).map(td => td.innerText.trim()));
  });
}

// Scrape one segment
async function scrapeSegment(browser, tab) {
  const page = await browser.newPage();
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  const clicked = await clickByText(page, tab.labels);
  if (!clicked) return [];

  await page.waitForTimeout(2000);

  const data = await extractTable(page);
  return data;
}

(async () => {
  const browser = await chromium.launch();
  const allResults = {};

  for (const tab of TABS) {
    const rows = await scrapeSegment(browser, tab);
    allResults[tab.segment] = rows;
  }

  await browser.close();

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const csv = Papa.unparse(Object.entries(allResults).flatMap(([seg, rows]) =>
    rows.map(r => [seg, ...r])
  ));

  const outFile = `${OUT_DIR}/ccil-data.csv`;
  fs.writeFileSync(outFile, csv);
  console.log(`✅ Data saved to ${outFile}`);
})();

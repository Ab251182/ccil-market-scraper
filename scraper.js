// scraper.js
import { chromium } from "@playwright/test";
import fs from "fs";
import Papa from "papaparse";

const START_URL = "https://www.ccilindia.com/market-watch";

// Keep these three tabs to save run time/cost.
// You can add WI / OddLot later by uncommenting.
const TABS = [
  { labels: ["CG Mkt. Watch","Central Government","G-Sec"], segment: "Central Government Market Watch" },
  { labels: ["SG Mkt. Watch","State Government","SDL"],     segment: "State Government Market Watch" },
  { labels: ["T-Bills Mkt. Watch","T Bills","Treasury Bills"], segment: "T-Bills Market Watch" },
  // { labels: ["WI Mkt. Watch","When-Issued","WI"], segment: "WI Market Watch" },
  // { labels: ["OddLot","Odd Lot","Oddlot"],        segment: "Odd Lot" },
];

const OUT_DIR = "docs/data"; // publish with GitHub Pages

function slug(s){ return (s||"").toLowerCase().replace(/\s+/g,"_").replace(/[^\w_]/g,""); }

async function clickByText(page, texts) {
  for (const t of texts) {
    try { await page.getByText(t, { exact:false }).first().click({ timeout: 2500 }); return true; } catch {}
    try { await page.locator(`text=${t}`).first().click({ timeout: 2500 }); return true; } catch {}
  }
  return false;
}

async function waitForAnyTable(page){
  try { await page.waitForSelector("table", { timeout: 25000 }); } catch {}
  await page.waitForTimeout(700);
}

async function chooseMaxPageSize(page){
  try {
    const sel = page.locator('select[name$="_length"], .dataTables_length select').first();
    if (await sel.count()) {
      await sel.selectOption({ label: "100" }).catch(()=>{});
      await sel.selectOption("100").catch(()=>{});
      await page.waitForTimeout(300);
    }
  } catch {}
}

async function extractVisibleTables(page, segmentLabel) {
  const rows = await page.evaluate((segmentLabel) => {
    const slug = (s)=> (s||"").toLowerCase().replace(/\s+/g,"_").replace(/[^\w_]/g,"");
    function headersOf(tbl){
      const ths = tbl.querySelectorAll("thead th");
      if (ths && ths.length) return Array.from(ths).map(x => x.innerText.trim());
      const first = tbl.querySelector("tr");
      if (!first) return [];
      return Array.from(first.querySelectorAll("th,td")).map(x => x.innerText.trim());
    }
    function labelFor(tbl){
      let el = tbl;
      for (let i=0;i<6 && el;i++){
        el = el.previousElementSibling;
        if (!el) break;
        const t = (el.textContent||"").trim();
        if (/Market Watch/i.test(t)) return t;
      }
      return segmentLabel || "Unknown";
    }
    function rowsOf(tbl,label){
      const hdrs = headersOf(tbl);
      let body = Array.from(tbl.querySelectorAll("tbody tr"));
      if (!body.length) body = Array.from(tbl.querySelectorAll("tr")).slice(1);
      const out=[];
      for (const tr of body){
        const cells = Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim());
        if (!cells.length) continue;
        const rec = {};
        hdrs.forEach((h,i)=>{ rec[slug(h || `col_${i+1}`)] = cells[i] ?? ""; });
        rec.segment_label = label;
        out.push(rec);
      }
      return out;
    }
    const tables = Array.from(document.querySelectorAll("table"))
      .filter(t => t.offsetParent !== null && t.querySelectorAll("tr").length > 1);
    let out = [];
    for (const t of tables) out = out.concat(rowsOf(t, labelFor(t)));
    return out;
  }, segmentLabel);
  return rows || [];
}

async function paginateAndExtract(page, segmentLabel) {
  let total = [];
  for (let safe=0; safe<10; safe++){      // hard stop after 10 pages
    await waitForAnyTable(page);
    await chooseMaxPageSize(page);
    total = total.concat(await extractVisibleTables(page, segmentLabel));

    const hasNext = await page.evaluate(() => {
      const cand = document.querySelector(
        '.dataTables_paginate .next:not(.disabled), .paginate_button.next:not(.disabled)'
      );
      return !!(cand && cand.offsetParent !== null);
    });
    if (!hasNext) break;

    try {
      const link = page.locator(
        '.dataTables_paginate .next:not(.disabled) a, .paginate_button.next:not(.disabled) a'
      ).first();
      if (await link.count()) await link.click({ timeout: 1500 });
      else await page.locator(
        '.dataTables_paginate .next:not(.disabled), .paginate_button.next:not(.disabled)'
      ).first().click({ timeout: 1500 });
    } catch { break; }

    await page.waitForTimeout(500);
  }
  return total;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // cut bandwidth (cheaper & faster)
  await page.route('**/*', route => {
    const t = route.request().resourceType();
    return ['image','font','stylesheet','media'].includes(t) ? route.abort() : route.continue();
  });

  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForAnyTable(page);

  let all = [];
  for (const tab of TABS) {
    await clickByText(page, tab.labels);
    const rows = await paginateAndExtract(page, tab.segment);
    if (rows.length === 0) {
      // fallback: at least get the current page
      all = all.concat(await extractVisibleTables(page, tab.segment));
    } else {
      all = all.concat(rows);
    }
  }

  await browser.close();

  // ensure output dirs exist
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync("docs/index.html",
`<html><body>
<h3>CCIL Scraper – latest</h3>
<ul>
<li><a href="data/ccil_latest.csv">data/ccil_latest.csv</a></li>
<li><a href="data/ccil_latest.json">data/ccil_latest.json</a></li>
</ul></body></html>`);

  // save JSON + CSV (latest + timestamped)
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(`${OUT_DIR}/ccil_latest.json`, JSON.stringify(all, null, 2));
  fs.writeFileSync(`${OUT_DIR}/ccil_${ts}.json`, JSON.stringify(all, null, 2));

  const csv = Papa.unparse(all);
  fs.writeFileSync(`${OUT_DIR}/ccil_latest.csv`, csv);
  fs.writeFileSync(`${OUT_DIR}/ccil_${ts}.csv`, csv);

  console.log(`Saved ${all.length} rows.`);
}

run().catch(e => { console.error(e); process.exit(1); });

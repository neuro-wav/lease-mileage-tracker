// scrape.js
// Two-pass scrape:
//   Pass 1 (list page)  — item names, order dates, order IDs  (no recommendations here)
//   Pass 2 (detail page) — return deadline + return status only

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const COOKIES_FILE = path.join(__dirname, 'cookies.json');
const ORDERS_FILE  = path.join(__dirname, 'orders.json');
const DAYS_BACK    = 90;   // how far back to scan
const PAGE_DELAY   = 1500; // ms between detail page loads

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── helpers ─────────────────────────────────────────────────────────────────

function extractOrderId(url) {
  const m = url.match(/orderID=([0-9A-Z\-]+)/i);
  return m ? m[1] : null;
}

function parseAmazonDate(str) {
  if (!str) return null;
  str = str.trim().replace(/\s+/g, ' ');
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  const d2 = new Date(`${str}, ${new Date().getFullYear()}`);
  return isNaN(d2.getTime()) ? null : d2;
}

async function launchBrowser(cookies) {
  const browser = await chromium.launch({ headless: false });
  const context  = await browser.newContext({ userAgent: UA });
  await context.addCookies(cookies);
  const page = await context.newPage();
  return { browser, context, page };
}

// Lines to skip when extracting item names from card text.
// Uses \b word boundaries so extra inserted words (e.g. "Write a PRODUCT review") still match.
const SKIP_LINE = /\b(order\s+placed|orders|total|ship\s+to|view\s+order|return\s+or\s+replace|buy\s+it\s+again|write\s+a(\s+\w+)?\s+review|track\s+package|get\s+support|share\s+gift|leave\s+seller|invoice|archive\s+order|and\s+\d+\s+more|prime|free\s+delivery|delivered|arriving|arrives|estimated|sunday|monday|tuesday|wednesday|thursday|friday|saturday|ask\s+\w*\s*question|package\s+was\s+left|purchased\s+at|your\s+package|delivery\s+instruction|left\s+(?:near|at|by)\s+the|front\s+door|porch|whole\s+foods|when\s+will\s+i\s+get|view\s+return|refund\s+status|\$[\d,.]|\d+\s+item)\b/i;

// Additional exact-prefix patterns for short UI strings that may not have word-boundary context
const SKIP_EXACT = /^(ask\s+product\s+question|write\s+a\s+product\s+review|your\s+package|purchased\s+at|when\s+will\s+i\s+get|view\s+return|refund\s+status|return\/refund|share\s+gift\s+receipt|get\s+product\s+support|return\s+complete\.?$)/i;

// Return/refund completion sentences — never product names
// Note: "Return complete." covered by SKIP_EXACT above; this handles longer sentence variants
const SKIP_STATUS = /\b(your\s+return\s+(?:is\s+)?complete|refund\s+(?:of\s+\$[\d,.]+\s+)?(?:has\s+been\s+)?issued|your\s+refund\s+(?:has\s+been\s+)?(?:issued|processed))\b/i;

// Per-item return status detection using Amazon's action links (Pass 2).
//
// Amazon shows mutually exclusive action links beneath each item on the order detail page:
//   Returned item:     "View return/refund status"   (return was initiated/completed)
//   Not-returned item: "Return or replace items"     (return can still be initiated)
//
// This is reliable because the return completion text ("Your return is complete...") appears
// in the ORDER HEADER, not adjacent to individual items — so proximity search on that text
// cannot distinguish which item was returned. The action links are item-level.
//
// Returns 'returned' | 'notreturned' | 'notfound'
function getItemReturnedBySignal(bodyText, itemName) {
  const anchor = itemName.slice(0, 50).trim();
  if (!anchor) return 'notfound';

  let pos = bodyText.indexOf(anchor);
  if (pos === -1) {
    // Fallback: try first 25 chars to handle minor name truncation between pages
    const shortAnchor = itemName.slice(0, 25).trim();
    pos = shortAnchor.length >= 10 ? bodyText.indexOf(shortAnchor) : -1;
    if (pos === -1) return 'notfound';
  }

  // 500 chars covers the item's action-link block (observed: 200-400 chars)
  // while staying well short of the next item (~360-515 char gaps observed)
  const windowText = bodyText.slice(pos, pos + 500);

  // Signal 1: only shown for items with an active or completed return
  if (/view\s+return\/refund\s+status/i.test(windowText)) return 'returned';

  // Signal 2: only shown for items that have NOT been returned yet
  if (/return\s+or\s+replace\s+items/i.test(windowText)) return 'notreturned';

  // Neither link found — item section may not have loaded fully; use order-level fallback
  return 'notfound';
}

// ── Extract per-item price from order detail page body text ──────────────────
// Looks for a dollar amount within a 600-char window after the item name.
// Amazon renders prices as "$XX.XX" near each item row.
// Returns a string like "$12.99" or null if not found.
function getItemPrice(bodyText, itemName) {
  const anchor = itemName.slice(0, 50).trim();
  if (!anchor) return null;

  let pos = bodyText.indexOf(anchor);
  if (pos === -1) {
    const shortAnchor = itemName.slice(0, 25).trim();
    pos = shortAnchor.length >= 10 ? bodyText.indexOf(shortAnchor) : -1;
    if (pos === -1) return null;
  }

  const windowText = bodyText.slice(pos, pos + 600);
  const m = windowText.match(/\$[\d,]+\.\d{2}/);
  return m ? m[0] : null;
}

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const DATE_RE = new RegExp(`(${MONTHS})\\s+\\d+,\\s+\\d{4}`, 'i');

function extractItemNamesFromCardText(cardText) {
  const lines = cardText.split('\n').map(l => l.trim()).filter(Boolean);
  const names = [];

  for (const line of lines) {
    // Skip short lines
    if (line.length < 12) continue;
    // Skip all-uppercase header lines (ORDER PLACED, TOTAL, SHIP TO, etc.)
    if (line === line.toUpperCase() && /[A-Z]/.test(line)) continue;
    // Skip date lines
    if (DATE_RE.test(line)) continue;
    // Skip known noise patterns
    if (SKIP_LINE.test(line) || SKIP_EXACT.test(line) || SKIP_STATUS.test(line)) continue;
    // Skip lines that look like prices alone
    if (/^\$[\d,.]+$/.test(line)) continue;
    // Skip lines that are just a name / address (short, no product-like tokens)
    if (line.length < 20 && !/\b(pack|set|count|oz|lb|kg|mm|inch|ft|cm|ml|qty|piece|roll|sheet|spool|bag|box|case|pair|kit)\b/i.test(line)) {
      // Could be a person's name or city — skip if no numbers and no product keywords
      if (!/\d/.test(line) && !/\b(wireless|bluetooth|usb|hdmi|led|pla|abs|tpu|nylon|carbon|fiber|filament|printer|camera|stand|holder|mount|clip|hook|cable|adapter|charger|case|cover|screen|protector|glass|tempered|silicone|leather|fabric|cotton|polyester|wool|linen|denim|fleece|knit|woven|mesh|foam|memory|gel|latex|spring|coil|pillow|mattress|chair|desk|shelf|drawer|closet|organizer|storage|bin|basket|bag|tote|backpack|wallet|purse|ring|necklace|bracelet|earring|watch|glasses|sunglasses|hat|cap|beanie|scarf|glove|sock|shoe|boot|sneaker|sandal|slipper|jacket|coat|vest|shirt|blouse|top|tank|dress|skirt|pant|jean|legging|short|suit|tie|belt|suspender|swimsuit|bikini|underwear|bra|pajama|robe|towel|sheet|pillow|blanket|curtain|rug|mat|plant|pot|vase|frame|mirror|lamp|bulb|fixture|fan|heater|cooler|humidifier|purifier|vacuum|mop|broom|brush|sponge|soap|shampoo|conditioner|lotion|cream|serum|mask|toner|sunscreen|lipstick|mascara|foundation|eyeshadow|blush|primer|powder|concealer|nail|polish|perfume|cologne|deodorant|toothbrush|toothpaste|floss|mouthwash|razor|blade|shaving|trimmer|clipper|comb|brush|dryer|straightener|curler|iron)\b/i.test(line)) {
        continue;
      }
    }

    if (!names.includes(line)) names.push(line);
  }

  return names;
}

// ── main ────────────────────────────────────────────────────────────────────

(async () => {
  if (!fs.existsSync(COOKIES_FILE)) {
    console.error('ERROR: cookies.json not found. Run "node setup-login.js" first.');
    process.exit(1);
  }

  const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
  console.log(`Loaded ${cookies.length} cookies`);

  let { browser, context, page } = await launchBrowser(cookies);

  // ══════════════════════════════════════════════════════════════
  // PASS 1 — Paginate order list, extract item names from cards
  // ══════════════════════════════════════════════════════════════
  console.log(`\n── Pass 1: scanning order history (last ${DAYS_BACK} days) ──`);

  // Map: orderId → { detailUrl, orderDate, itemNames: [] }
  const ordersMap = new Map();
  let startIndex = 0;
  let reachedCutoff = false;

  while (!reachedCutoff) {
    const url = `https://www.amazon.com/your-orders/orders?timeFilter=months-3&startIndex=${startIndex}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (e) {
      console.error(`List page load failed: ${e.message.split('\n')[0]}`);
      break;
    }

    const cur = page.url();
    if (cur.includes('signin') || cur.includes('sign-in')) {
      console.error('Session expired. Re-run "node setup-login.js".');
      await browser.close(); process.exit(1);
    }
    if (cur.includes('validateCaptcha') || cur.includes('robot')) {
      console.error('CAPTCHA detected. Re-run "node setup-login.js".');
      await browser.close(); process.exit(1);
    }

    // Each order card — try multiple selectors Amazon has used
    const cards = await page.$$([
      '[data-component="orderCard"]',
      '.order-card',
      '.a-box-group.order',
      // Fallback: any div/section that contains a "View order details" link
      // We'll handle via the link approach below if cards array is empty
    ].join(', '));

    // If no card containers found, fall back to finding order links directly
    if (cards.length === 0) {
      // Grab all order-detail links and extract order IDs
      const linkEls = await page.$$('a[href*="orderID="], a[href*="order-details"]');
      if (linkEls.length === 0) {
        console.log('No orders found on this page. Done paginating.');
        break;
      }
      let newFound = 0;
      for (const el of linkEls) {
        const href = await el.getAttribute('href');
        if (!href) continue;
        const detailUrl = href.startsWith('http') ? href : 'https://www.amazon.com' + href;
        const orderId = extractOrderId(detailUrl);
        if (!orderId || ordersMap.has(orderId)) continue;
        // No card text available — item names will come from detail page fallback
        ordersMap.set(orderId, { detailUrl, orderDate: null, itemNames: [] });
        newFound++;
      }
      if (newFound === 0) break;
      startIndex += 10;
      continue;
    }

    let newOnPage = 0;

    for (const card of cards) {
      let cardText = '';
      try { cardText = await card.innerText(); } catch { continue; }

      // Extract order date from card text
      const dateMatch = cardText.match(DATE_RE);
      const orderDate = dateMatch ? parseAmazonDate(dateMatch[0]) : null;

      // Stop paginating if this order is older than DAYS_BACK
      if (orderDate) {
        const daysAgo = (Date.now() - orderDate.getTime()) / 86400000;
        if (daysAgo > DAYS_BACK) {
          console.log(`Reached ${DAYS_BACK}-day cutoff. Stopping.`);
          reachedCutoff = true;
          break;
        }
      }

      // Get detail URL
      let detailUrl = null;
      let orderId = null;
      try {
        const linkEl = await card.$('a[href*="orderID="], a[href*="order-details"]');
        if (linkEl) {
          const href = await linkEl.getAttribute('href');
          if (href) {
            detailUrl = href.startsWith('http') ? href : 'https://www.amazon.com' + href;
            orderId = extractOrderId(detailUrl);
          }
        }
      } catch {}

      if (!orderId || !detailUrl || ordersMap.has(orderId)) continue;

      // Skip Whole Foods pickup orders — no standard return window applies
      if (/purchased\s+at\s+whole\s+foods|whole\s+foods\s+market/i.test(cardText)) {
        console.log(`  Skipping Whole Foods order ${orderId}`);
        continue;
      }

      // Extract item names from card text
      const itemNames = extractItemNamesFromCardText(cardText);

      // Detect "and X more items" — need detail page fallback for full list
      const moreMatch = cardText.match(/and\s+(\d+)\s+more\s+item/i);
      const hasMore = !!moreMatch;

      ordersMap.set(orderId, { detailUrl, orderDate, itemNames, hasMore });
      newOnPage++;

      console.log(`  Found order ${orderId} | ${itemNames.length} item(s)${hasMore ? ' + more' : ''}`);
    }

    if (reachedCutoff) break;
    if (newOnPage === 0) break;
    startIndex += 10;
  }

  console.log(`\nPass 1 complete. ${ordersMap.size} orders found.`);

  // ══════════════════════════════════════════════════════════════
  // PASS 2 — Visit detail pages for: return deadline, return status,
  //           and full item list if "and X more items" was shown
  // ══════════════════════════════════════════════════════════════
  console.log('\n── Pass 2: visiting order detail pages ──');

  const orderList = Array.from(ordersMap.entries()).map(([orderId, v]) => ({ orderId, ...v }));
  const finalRecords = [];

  for (let i = 0; i < orderList.length; i++) {
    const { orderId, detailUrl, orderDate, itemNames, hasMore } = orderList[i];
    console.log(`[${i + 1}/${orderList.length}] ${orderId}...`);

    let returnDeadline    = null;
    let bodyText          = '';       // hoisted so write loop can access it for per-item status
    let orderReturnStatus = null;     // order-level fallback if item name not found in bodyText
    let resolvedNames     = itemNames;
    let resolvedOrderDate = orderDate;

    try {
      if (page.isClosed()) {
        try { await browser.close(); } catch {}
        ({ browser, context, page } = await launchBrowser(cookies));
      }

      await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(PAGE_DELAY);

      bodyText = await page.innerText('body');

      // ── Order date fallback from detail page ──
      if (!resolvedOrderDate) {
        const pm = bodyText.match(/Order(?:ed)?(?:\s+placed)?\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+\d{4})/i);
        if (pm) resolvedOrderDate = parseAmazonDate(pm[1]);
      }

      // ── Return deadline ──
      const retMatch = bodyText.match(
        /[Rr]eturn(?:\s+items?|\s+eligible)?\s+(?:through|by)\s+((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s*\d{4})/
      );
      if (retMatch) returnDeadline = parseAmazonDate(retMatch[1]);

      if (!returnDeadline) {
        const thruMatch = bodyText.match(/\breturn\b[\s\S]{0,80}(?:through|by)\s+((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s*\d{4})/i);
        if (thruMatch) returnDeadline = parseAmazonDate(thruMatch[1]);
      }

      // ── Order-level return / refund status (used as fallback per item below) ──
      if (/\b(return(?:ed|s?\s+(?:initiated|started|complete|processed))|refund(?:ed|\s+(?:issued|processed|of\s+\$[\d.]+)))\b/i.test(bodyText)) {
        orderReturnStatus = 'returned';
      }

      // ── Full item list if "and X more items" on list page ──
      if (hasMore || resolvedNames.length === 0) {
        // Cut body text at the first recommendations/sponsored section to avoid noise
        const cutIdx = bodyText.search(/\b(recommendations|customers\s+also|sponsored\s+products|you\s+might\s+also|similar\s+items|customers\s+who\s+viewed|frequently\s+bought)\b/i);
        const orderedSection = cutIdx > 0 ? bodyText.slice(0, cutIdx) : bodyText;

        // Use the same line-based filtering as Pass 1 — avoids pulling in DOM link text
        // from recommendations, UI buttons ("Ask Product Question"), or delivery notices
        const candidates = extractItemNamesFromCardText(orderedSection);
        if (candidates.length > 0) resolvedNames = candidates;
      }

      console.log(`  ↳ ${resolvedNames.length} item(s) | return: ${returnDeadline ? returnDeadline.toLocaleDateString() : 'unknown'}${orderReturnStatus ? ' | RETURNED (order-level)' : ''}`);

    } catch (err) {
      const msg = err.message.split('\n')[0];
      console.error(`  ↳ ERROR: ${msg}`);
      try { await browser.close(); } catch {}
      try { ({ browser, context, page } = await launchBrowser(cookies)); } catch {}
    }

    // ── Delivery date fallback for return deadline ──
    // (We no longer extract delivery date separately — return deadline is either
    //  explicit from page text, or falls back to orderDate + 30 days)
    if (!returnDeadline && resolvedOrderDate) {
      returnDeadline = new Date(resolvedOrderDate.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    // ── Write one record per item ──
    const names = resolvedNames.length > 0 ? resolvedNames : ['(item name not found — check order)'];
    for (const name of names) {
      // Per-item return status via action-link detection (getItemReturnedBySignal).
      // Three return values:
      //   'returned'    — "View return/refund status" link found after item name
      //   'notreturned' — "Return or replace items" link found after item name (definitive: not returned)
      //   'notfound'    — item name not located in page → fall back to order-level status
      let itemReturnStatus;
      if (name === '(item name not found — check order)') {
        itemReturnStatus = orderReturnStatus;
      } else {
        const perItem = getItemReturnedBySignal(bodyText, name);
        if (perItem === 'returned')         itemReturnStatus = 'returned';
        else if (perItem === 'notreturned') itemReturnStatus = null;   // definitively not returned
        else                               itemReturnStatus = orderReturnStatus; // notfound: use fallback
      }

      finalRecords.push({
        orderId,
        itemName:       name,
        price:          getItemPrice(bodyText, name),
        orderDate:      resolvedOrderDate ? resolvedOrderDate.toISOString() : null,
        returnDeadline: returnDeadline    ? returnDeadline.toISOString()    : null,
        returnStatus:   itemReturnStatus,
        detailUrl,
        scrapedAt: new Date().toISOString()
      });
    }
  }

  fs.writeFileSync(ORDERS_FILE, JSON.stringify(finalRecords, null, 2));
  console.log(`\n✅  Done. ${finalRecords.length} item record(s) from ${orderList.length} order(s) saved to orders.json`);

  try { await browser.close(); } catch {}
})();

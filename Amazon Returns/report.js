// report.js
// Reads orders.json, calculates days remaining in each return window,
// groups items into urgency buckets, and writes report.txt + report.html.
// Prints a one-line summary to stdout (used by notify.js).

const fs   = require('fs');
const path = require('path');

const ORDERS_FILE = path.join(__dirname, 'orders.json');
const REPORT_FILE = path.join(__dirname, 'report.txt');
const HTML_FILE   = path.join(__dirname, 'report.html');

if (!fs.existsSync(ORDERS_FILE)) {
  console.error('ERROR: orders.json not found. Run "node scrape.js" first.');
  process.exit(1);
}

const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));

// Normalize today to midnight so daysLeft is always whole-day based
const today = new Date();
today.setHours(0, 0, 0, 0);

// ---- Bucket definitions (ordered for display) ----
const BUCKET_KEYS = ['urgent', 'week1', 'week2', 'week3', 'later', 'returned', 'expired'];
const buckets = {
  urgent:   { label: 'URGENT — Less than 7 days left',  emoji: '🚨', items: [] },
  week1:    { label: '1 Week Left (7–13 days)',          emoji: '⚠️', items: [] },
  week2:    { label: '2 Weeks Left (14–20 days)',        emoji: '📦', items: [] },
  week3:    { label: '3 Weeks Left (21–27 days)',        emoji: '📦', items: [] },
  later:    { label: '4+ Weeks Left (28+ days)',         emoji: '✅', items: [] },
  returned: { label: 'Return Complete',                  emoji: '↩️', items: [] },
  expired:  { label: 'Return Window Expired',            emoji: '✗',  items: [] }
};

// ---- Classify each order item ----
for (const order of orders) {
  // Returned items go into their own bucket regardless of deadline
  if (order.returnStatus === 'returned') {
    buckets.returned.items.push({
      name:      order.itemName,
      orderId:   order.orderId,
      price:     order.price || null,
      daysLeft:  null,
      lastDate:  null,
      detailUrl: order.detailUrl
    });
    continue;
  }

  if (!order.returnDeadline) continue;

  const deadline = new Date(order.returnDeadline);
  deadline.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((deadline - today) / (1000 * 86400));

  const lastDate = deadline.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });

  const item = {
    name:      order.itemName,
    orderId:   order.orderId,
    price:     order.price || null,
    daysLeft,
    lastDate,
    detailUrl: order.detailUrl,
    hasError:  !!order.error
  };

  if      (daysLeft < 0)  buckets.expired.items.push(item);
  else if (daysLeft < 7)  buckets.urgent.items.push(item);
  else if (daysLeft < 14) buckets.week1.items.push(item);
  else if (daysLeft < 21) buckets.week2.items.push(item);
  else if (daysLeft < 28) buckets.week3.items.push(item);
  else                    buckets.later.items.push(item);
}

// Sort each bucket by daysLeft ascending (most urgent first)
for (const key of BUCKET_KEYS) {
  buckets[key].items.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ---- Compute summary counts ----
const urgentCount   = buckets.urgent.items.length;
const returnedCount = buckets.returned.items.length;
const activeCount   = ['urgent', 'week1', 'week2', 'week3', 'later']
  .reduce((sum, k) => sum + buckets[k].items.length, 0);

const summaryLine = urgentCount > 0
  ? `${urgentCount} item(s) need return SOON. ${activeCount} total returnable.${returnedCount ? ` ${returnedCount} already returned.` : ''}`
  : `${activeCount} returnable item(s). None urgent this week.${returnedCount ? ` ${returnedCount} already returned.` : ''}`;

// ---- Build plain-text report ----
const reportDate = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

const lines = [];
lines.push(`Amazon Return Window Tracker — ${reportDate}`);
lines.push('='.repeat(60));
lines.push('');

for (const key of BUCKET_KEYS) {
  const bucket = buckets[key];
  if (bucket.items.length === 0) continue;

  lines.push(`[ ${bucket.label} ]`);
  lines.push('-'.repeat(50));

  for (const item of bucket.items) {
    if (key === 'returned') {
      lines.push(`  ↩  ${item.name}`);
      lines.push(`     Order ${item.orderId} | Return complete`);
    } else if (key === 'expired') {
      lines.push(`  ✗  ${item.name}`);
      lines.push(`     Order ${item.orderId} | Expired: ${item.lastDate}`);
    } else if (key === 'urgent') {
      const dayWord = item.daysLeft === 1 ? 'day' : 'days';
      lines.push(`  !! ${item.name}`);
      lines.push(`     Order ${item.orderId} | ${item.daysLeft} ${dayWord} left — return by ${item.lastDate}`);
    } else {
      lines.push(`   • ${item.name}`);
      lines.push(`     Order ${item.orderId} | ${item.daysLeft} days left — return by ${item.lastDate}`);
    }
  }
  lines.push('');
}

lines.push(summaryLine);

const reportText = lines.join('\n');
fs.writeFileSync(REPORT_FILE, reportText);

// ---- Build HTML report ----
const HEADER_COLORS = {
  urgent:   '#8b2a0a',   // deep highway sienna
  week1:    '#a07820',   // amber mustard
  week2:    '#4a7fa5',   // map water blue
  week3:    '#a08c6e',   // dusty road tan
  later:    '#5a7a4a',   // park green
  returned: '#9a9088',   // warm gray
  expired:  '#b8afa6'    // muted warm gray
};

// Buckets that start expanded (the rest start collapsed)
const DEFAULT_OPEN = new Set(['urgent', 'week1', 'week2']);

const htmlSections = [];

for (const key of BUCKET_KEYS) {
  const bucket = buckets[key];
  if (bucket.items.length === 0) continue;

  const accent = HEADER_COLORS[key];
  const isOpen = DEFAULT_OPEN.has(key) ? ' open' : '';
  const count  = bucket.items.length;
  const itemWord = count === 1 ? 'item' : 'items';

  const rows = bucket.items.map((item, idx) => {
    const evenBg = idx % 2 === 1 ? 'background:rgba(0,0,0,.025)' : '';

    const daysDisplay = key === 'returned'
      ? '<span class="days-returned">↩ Returned</span>'
      : key === 'expired'
        ? '<span class="days-expired">Expired</span>'
        : key === 'urgent'
          ? `<span class="days-urgent">${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'}</span>`
          : `${item.daysLeft} days`;

    const returnByDisplay = key === 'returned' ? '—' : escapeHtml(item.lastDate || '—');

    const priceDisplay = item.price ? escapeHtml(item.price) : '—';

    return `
        <tr style="${evenBg}">
          <td><a href="${escapeHtml(item.detailUrl)}">${escapeHtml(item.name)}</a></td>
          <td class="col-price">${priceDisplay}</td>
          <td class="col-days">${daysDisplay}</td>
          <td class="col-date return-by">${returnByDisplay}</td>
          <td class="col-order"><span class="order-id">${escapeHtml(item.orderId)}</span></td>
        </tr>`;
  }).join('');

  htmlSections.push(`
    <details${isOpen} style="--accent:${accent}">
      <summary>
        <span class="summary-left">${bucket.emoji}&nbsp; ${escapeHtml(bucket.label)}</span>
        <span class="summary-right">
          <span class="badge">${count} ${itemWord}</span>
          <span class="chevron">▶</span>
        </span>
      </summary>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th class="col-price">Price</th>
              <th class="col-days">Days Left</th>
              <th class="col-date">Return By</th>
              <th class="col-order">Order</th>
            </tr>
          </thead>
          <tbody>${rows}
          </tbody>
        </table>
      </div>
    </details>`);
}

const summaryBg = urgentCount > 0 ? '#f5e8e2' : '#edeae4';
const summaryBorder = urgentCount > 0 ? '#8b2a0a' : '#5a7a4a';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Amazon Returns — ${escapeHtml(reportDate)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f5f0eb;
      color: #2e2a27;
      padding: 32px 20px 60px;
      line-height: 1.45;
    }

    .container { max-width: 920px; margin: 0 auto; }

    /* ── Page header ── */
    .page-header { margin-bottom: 28px; }
    .page-header h1 { font-size: 24px; font-weight: 700; color: #1c1916; letter-spacing: -.3px; }
    .page-header .subtitle { font-size: 13px; color: #7a6e64; margin-top: 5px; }
    .controls { display: flex; gap: 8px; margin-top: 14px; }
    .controls button {
      font-size: 12px; padding: 5px 12px;
      border: 1px solid #d4cdc5; border-radius: 5px;
      background: #eeeae4; cursor: pointer; color: #5a504a;
      transition: background .15s;
    }
    .controls button:hover { background: #e4ddd5; }

    /* ── Collapsible card ── */
    details {
      background: #faf7f3;
      border-radius: 10px;
      margin-bottom: 12px;
      box-shadow: 0 1px 3px rgba(46,42,39,.10), 0 1px 8px rgba(46,42,39,.05);
      overflow: hidden;
    }

    summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      cursor: pointer;
      user-select: none;
      border-left: 5px solid var(--accent);
      list-style: none;
    }
    summary::-webkit-details-marker { display: none; }
    summary:hover { background: rgba(46,42,39,.04); }

    .summary-left {
      display: flex; align-items: center; gap: 8px;
      font-weight: 650; font-size: 15px; color: var(--accent);
    }
    .summary-right { display: flex; align-items: center; gap: 10px; }

    .badge {
      background: var(--accent); color: #fff;
      border-radius: 20px; padding: 2px 11px;
      font-size: 12px; font-weight: 600;
    }

    .chevron {
      font-size: 10px; color: #b8afa6;
      display: inline-block; transition: transform .2s ease;
    }
    details[open] .chevron { transform: rotate(90deg); }

    /* ── Table ── */
    .table-wrap { overflow-x: auto; }

    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }

    thead tr { background: var(--accent); color: #fff; }
    th {
      padding: 8px 14px; font-weight: 600; text-align: left;
      font-size: 11.5px; text-transform: uppercase; letter-spacing: .5px;
      white-space: nowrap;
    }

    td { padding: 9px 14px; border-bottom: 1px solid #e8e2d8; vertical-align: middle; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover { background: rgba(46,42,39,.04) !important; }

    td a { color: #8b2a0a; text-decoration: none; }
    td a:hover { text-decoration: underline; }

    .col-days  { text-align: center; white-space: nowrap; width: 90px; }
    .col-price { text-align: right; white-space: nowrap; width: 80px; }
    .col-date     { white-space: nowrap; width: 160px; }
   td.col-date   { font-size: 13px; color: #6b5f57; }
   td.col-price  { font-size: 13px; font-variant-numeric: tabular-nums; color: #6b5f57; }
    .col-order { width: 175px; }

    .days-urgent   { font-weight: 700; color: #8b2a0a; }
    .days-returned { color: #9a9088; font-weight: 600; }
    .days-expired  { color: #b8afa6; }

    .order-id { font-size: 11px; color: #a89e96; font-family: ui-monospace, monospace; }

    /* ── Summary banner ── */
    .summary-banner {
      margin-top: 28px;
      padding: 14px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      border-left: 4px solid ${summaryBorder};
      background: ${summaryBg};
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="page-header">
      <h1>📦 Amazon Return Tracker</h1>
      <div class="subtitle">${escapeHtml(reportDate)}</div>
      <div class="controls">
        <button onclick="document.querySelectorAll('details').forEach(d=>d.open=true)">Expand All</button>
        <button onclick="document.querySelectorAll('details').forEach(d=>d.open=false)">Collapse All</button>
      </div>
    </div>

    ${htmlSections.join('\n')}

    <p class="summary-banner">${escapeHtml(summaryLine)}</p>

  </div>
</body>
</html>`;

fs.writeFileSync(HTML_FILE, html);

// Print summary line to stdout (read by notify.js)
console.log(summaryLine);

// ---- Helpers ----
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

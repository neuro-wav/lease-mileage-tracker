# Amazon Return Window Tracker

Checks your Amazon order history every Wednesday at 9am and sends a macOS notification showing how many days you have left to return each item.

---

## First-time Setup (do this once)

### 1. Install dependencies

```bash
cd "/Users/estherjeon/Claude Code/Amazon Returns"
npm install
npx playwright install chromium
```

> `npx playwright install chromium` downloads the Chromium browser binary (~300MB). Only needed once.

### 2. Log in to Amazon

```bash
node setup-login.js
```

A browser window opens. Log in normally (including MFA if you use it). The window closes automatically once login is detected. Your session is saved to `cookies.json`.

### 3. Test the full pipeline

```bash
bash run.sh
```

Check `run.log` for output. After it finishes:
- `orders.json` — raw order data
- `report.txt` — plain text report
- `report.html` — color-coded report (opens in browser if urgent items exist)

### 4. Install the weekly scheduler

```bash
cp com.user.amazon-returns.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.user.amazon-returns.plist
```

The job will now fire automatically every **Wednesday at 9:00 AM**.

### 5. (Optional) Trigger it immediately to verify

```bash
launchctl start com.user.amazon-returns
```

---

## How It Works

```
run.sh
  └─ scrape.js     →  orders.json     (scrapes Amazon, parses return deadlines)
  └─ report.js     →  report.txt      (groups items by days remaining)
                   →  report.html     (color-coded, click through to Amazon)
  └─ notify.js     →  macOS notification + opens report.html if urgent
```

**Return window grouping:**
| Group | Days left |
|---|---|
| 🚨 URGENT | 0–6 days |
| ⚠️ 1 Week Left | 7–13 days |
| 📦 2 Weeks Left | 14–20 days |
| 📦 3 Weeks Left | 21–27 days |
| ✅ 4+ Weeks | 28+ days |
| ✗ Expired | Past deadline |

---

## Maintenance

### Session expired (scrape.js says "session expired")
Amazon cookies last ~30–90 days. Re-run setup once they expire:
```bash
node setup-login.js
```

### Stop the weekly job
```bash
launchctl unload ~/Library/LaunchAgents/com.user.amazon-returns.plist
```

### Restart the weekly job after changes
```bash
launchctl unload ~/Library/LaunchAgents/com.user.amazon-returns.plist
cp com.user.amazon-returns.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.user.amazon-returns.plist
```

### Check logs
```bash
# Pipeline log (scrape/report/notify output)
cat run.log

# launchd-level logs
cat launchd.out.log
cat launchd.err.log
```

### Notifications not showing
Go to **System Settings > Notifications** and make sure **Script Editor** or **Terminal** has notifications enabled.

---

## Files

| File | Purpose |
|---|---|
| `setup-login.js` | One-time login; saves `cookies.json` |
| `scrape.js` | Scrapes Amazon order history |
| `report.js` | Generates grouped report |
| `notify.js` | Sends macOS notification |
| `run.sh` | Pipeline runner (called by launchd) |
| `com.user.amazon-returns.plist` | launchd schedule config |
| `cookies.json` | Amazon session (auto-generated, do not share) |
| `orders.json` | Scraped order data (auto-generated) |
| `report.txt` | Plain-text report (auto-generated) |
| `report.html` | Color-coded HTML report (auto-generated) |
| `run.log` | Pipeline run log (auto-generated) |

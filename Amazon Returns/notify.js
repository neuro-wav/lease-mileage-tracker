// notify.js
// Sends a macOS system notification with the return window summary.
// If urgent items exist, also opens report.html in the default browser.

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const REPORT_FILE = path.join(__dirname, 'report.txt');
const HTML_FILE   = path.join(__dirname, 'report.html');
const TMP_SCRIPT  = '/tmp/amazon-returns-notify.scpt';

// ---- Read summary line (last non-empty line of report.txt) ----
let summary = 'Amazon return window check complete.';
if (fs.existsSync(REPORT_FILE)) {
  const lines = fs.readFileSync(REPORT_FILE, 'utf8')
    .split('\n')
    .filter(l => l.trim().length > 0);
  if (lines.length > 0) {
    summary = lines[lines.length - 1].trim();
  }
}

// macOS notification body is truncated around 120 chars; keep it tight
const notifText = summary.length > 110 ? summary.slice(0, 107) + '...' : summary;

// ---- Send notification via AppleScript temp file ----
// Writing to a .scpt file avoids shell quoting nightmares with double/single quotes in the message.
const escapedText = notifText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const scriptContent = `display notification "${escapedText}" with title "Amazon Returns 📦" subtitle "Weekly Return Check"`;

try {
  fs.writeFileSync(TMP_SCRIPT, scriptContent, 'utf8');
  execSync(`osascript "${TMP_SCRIPT}"`, { stdio: 'inherit' });
  console.log('Notification sent:', notifText);
} catch (err) {
  console.error('osascript notification failed:', err.message);
  console.error('Tip: Ensure Terminal (or the process running this) has notification permission in');
  console.error('System Settings > Notifications');
} finally {
  // Clean up temp file
  try { fs.unlinkSync(TMP_SCRIPT); } catch {}
}

// ---- Open HTML report if urgent items detected ----
const isUrgent = /SOON|urgent|\!\!/i.test(summary);
if (isUrgent && fs.existsSync(HTML_FILE)) {
  try {
    execSync(`open "${HTML_FILE.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
    console.log('Opened report.html in browser (urgent items present).');
  } catch (err) {
    console.error('Could not open HTML report:', err.message);
  }
}

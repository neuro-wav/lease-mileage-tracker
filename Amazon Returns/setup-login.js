// setup-login.js
// One-time interactive script: opens a visible browser, lets you log in to Amazon,
// then saves the session cookies to cookies.json for use by scrape.js.
// Re-run only if scrape.js reports that your session has expired.

const { chromium } = require('playwright');
const fs            = require('fs');
const path          = require('path');
const readline      = require('readline');

const COOKIES_FILE = path.join(__dirname, 'cookies.json');

function waitForEnter(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

(async () => {
  console.log('Opening browser for Amazon login...');
  console.log('─'.repeat(50));

  const browser = await chromium.launch({ headless: false });
  const context  = await browser.newContext();
  const page     = await context.newPage();

  await page.goto('https://www.amazon.com/gp/sign-in.html');

  // Simply wait for the user to tell us they are done.
  // No URL polling — no risk of closing the browser too early.
  console.log('\n👉  Log in to Amazon in the browser window.');
  console.log('    Complete any MFA steps too.\n');
  await waitForEnter('When you are fully logged in and see your Amazon homepage, press Enter here... ');

  // Save cookies
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  console.log(`\n✅  Saved ${cookies.length} cookies to cookies.json`);
  console.log('    Setup complete! You can now run: node scrape.js\n');

  await browser.close();
})();

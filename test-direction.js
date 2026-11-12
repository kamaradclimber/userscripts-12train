// Verify the direction and button label before/after noon in Europe/Paris.
// Run: node test-direction.js
const assert = require('assert');
const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(path.join(__dirname, '12train-next-train.user.js'), 'utf8');

async function checkAt(browser, { utcTime, label, originName, originCode, destinationName, destinationCode }) {
  const context = await browser.newContext({ timezoneId: 'Europe/Paris' });
  const page = await context.newPage();
  const timestamp = new Date(utcTime).getTime();

  // Freeze Date without freezing timers/network waits used by Playwright.
  await page.addInitScript((epoch) => {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(epoch);
        else super(...args);
      }
      static now() { return epoch; }
    }
    window.Date = FixedDate;
  }, timestamp);

  let requestBody;
  let resolveRequest;
  const requestSent = new Promise((resolve) => { resolveRequest = resolve; });
  await page.route('**/forms/form-sales-journey-planner-outward.php', async (route) => {
    requestBody = route.request().postData();
    resolveRequest();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"errors":[{"code":"test","message":"intercepted"}]}',
    });
  });

  await page.goto('https://www.12train.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.addScriptTag({ content: SCRIPT });
  await page.waitForTimeout(200);

  const button = page.locator('#t12-next-train-btn');
  assert.strictEqual(await button.textContent(), label, `wrong label at ${utcTime}`);
  await button.click();
  await requestSent;

  assert.ok(requestBody, `search request was not sent at ${utcTime}`);
  const params = new URLSearchParams(requestBody);
  assert.strictEqual(params.get('form[origin]'), originName);
  assert.strictEqual(params.get('form[originCode]'), originCode);
  assert.strictEqual(params.get('form[destination]'), destinationName);
  assert.strictEqual(params.get('form[destinationCode]'), destinationCode);
  assert.strictEqual(params.get('journey_planner_form_query_passengers[0][cards][0]'), 'FN30');

  console.log(`${utcTime}: ${label} — PASS`);
  await context.close();
}

(async () => {
  const browser = await firefox.launch({ headless: true });
  try {
    await checkAt(browser, {
      utcTime: '2026-11-12T10:59:00Z', // 11:59 in Paris (CET)
      label: 'Next train Chartres → Montparnasse',
      originName: 'Chartres',
      originCode: 'FRQTJ',
      destinationName: 'Paris Montparnasse',
      destinationCode: 'FRPMO',
    });
    await checkAt(browser, {
      utcTime: '2026-11-12T11:00:00Z', // 12:00 in Paris (CET)
      label: 'Next train Montparnasse → Chartres',
      originName: 'Paris Montparnasse',
      originCode: 'FRPMO',
      destinationName: 'Chartres',
      destinationCode: 'FRQTJ',
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

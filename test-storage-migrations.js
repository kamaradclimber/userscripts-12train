// Check localStorage migration, corruption recovery, and future-schema safety.
// Run: node test-storage-migrations.js
const assert = require('assert');
const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(path.join(__dirname, '12train-next-train.user.js'), 'utf8');

async function runCase(browser, name, seed, check) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => { throw error; });
  await page.goto('https://www.12train.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate((values) => {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  }, seed);
  await page.addScriptTag({ content: SCRIPT });
  await page.waitForTimeout(100);
  await check(page);
  console.log(`${name}: PASS`);
  await context.close();
}

(async () => {
  const browser = await firefox.launch({ headless: true });
  try {
    await runCase(browser, 'legacy keys migrate and remain as rollback data', {
      t12_first_name: 'Aline',
      t12_last_name: 'Test',
      t12_birth_date: '14/07/1985',
      t12_card_number: 'NEWER-CARD-VALUE',
      t12_fn30_number: 'OLDER-CARD-VALUE',
    }, async (page) => {
      const result = await page.evaluate(() => ({
        store: JSON.parse(localStorage.getItem('t12.store')),
        oldName: localStorage.getItem('t12_first_name'),
        oldCard: localStorage.getItem('t12_card_number'),
      }));
      assert.strictEqual(result.store.schemaVersion, 1);
      assert.strictEqual(result.store.travellers.length, 1);
      assert.strictEqual(result.store.travellers[0].isDefault, true);
      assert.strictEqual(result.store.travellers[0].firstName, 'Aline');
      assert.strictEqual(result.store.travellers[0].lastName, 'Test');
      assert.strictEqual(result.store.travellers[0].birthDate, '14/07/1985');
      assert.strictEqual(result.store.travellers[0].cards[0].code, 'FN30');
      assert.strictEqual(result.store.travellers[0].cards[0].cardNumber, 'NEWER-CARD-VALUE');
      assert.strictEqual(result.oldName, 'Aline');
      assert.strictEqual(result.oldCard, 'NEWER-CARD-VALUE');
    });

    await runCase(browser, 'old card-number key remains supported', {
      t12_first_name: 'Aline',
      t12_fn30_number: 'OLD-CARD-VALUE',
    }, async (page) => {
      const store = await page.evaluate(() => JSON.parse(localStorage.getItem('t12.store')));
      assert.strictEqual(store.travellers[0].cards[0].cardNumber, 'OLD-CARD-VALUE');
    });

    const currentStore = {
      schemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      travellers: [{
        id: 'default-traveller',
        isDefault: true,
        firstName: 'Saved',
        lastName: 'Profile',
        birthDate: '2000-01-02',
        cards: [{ code: 'FN30', cardNumber: '' }],
      }],
    };
    await runCase(browser, 'current schema is retained', {
      't12.store': JSON.stringify(currentStore),
    }, async (page) => {
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('t12.store')));
      assert.deepStrictEqual(stored, currentStore);
    });

    const corrupt = '{ definitely not JSON';
    await runCase(browser, 'corrupt data is backed up before reset', {
      't12.store': corrupt,
    }, async (page) => {
      const result = await page.evaluate(() => ({
        keys: Object.keys(localStorage),
        store: JSON.parse(localStorage.getItem('t12.store')),
        notice: document.getElementById('t12-storage-notice')?.innerText,
      }));
      const backupKey = result.keys.find((key) => key.startsWith('t12.store.corrupt.'));
      assert.ok(backupKey, 'expected a timestamped recovery backup');
      assert.strictEqual(await page.evaluate((key) => localStorage.getItem(key), backupKey), corrupt);
      assert.strictEqual(result.store.schemaVersion, 1);
      assert.strictEqual(result.store.travellers[0].firstName, '');
      assert.match(result.notice, /copie a été sauvegardée/i);
    });

    const future = '{"schemaVersion":99,"futureData":"keep untouched"}';
    await runCase(browser, 'future schema is preserved read-only', {
      't12.store': future,
    }, async (page) => {
      const result = await page.evaluate(() => ({
        store: localStorage.getItem('t12.store'),
        notice: document.getElementById('t12-storage-notice')?.innerText,
      }));
      assert.strictEqual(result.store, future);
      assert.match(result.notice, /version plus récente/i);
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

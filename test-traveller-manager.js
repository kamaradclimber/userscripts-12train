// Verify traveller creation/editing, card storage, and default-only quick search.
// Run: node test-traveller-manager.js
const assert = require('assert');
const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await firefox.launch({ headless: true });
  try {
    const context = await browser.newContext({ timezoneId: 'Europe/Paris' });
    const page = await context.newPage();
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
    // The page bundle is already loaded; stub only the userscript's same-origin
    // catalogue fetch so this test never performs a live train search.
    await page.route('**/js/index.*.js', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'const JP_FORM_CARDS_LEVEL_3 = [{"level_two_id":"centre_val_de_loire","labels":[{"label":"Carte Rémi Liberté Jeune","code":"ODS_CARTE_RÉMI_LIBERTÉ_JEUNE","type":""},{"label":"Carte test ]","code":"CATALOG_ONLY_TEST","type":""}]}];function createPassengerCardsMenu(){}',
      });
    });
    await page.evaluate(() => {
      localStorage.setItem('t12_first_name', 'Me');
      localStorage.setItem('t12_last_name', 'Default');
      localStorage.setItem('t12_birth_date', '1985-07-14');
    });
    await page.addScriptTag({
      content: fs.readFileSync(path.join(__dirname, '12train-next-train.user.js'), 'utf8'),
    });

    await page.click('#t12-traveller-manager-btn');
    const manager = page.locator('#t12-traveller-manager');
    await manager.waitFor({ state: 'visible' });
    await manager.locator('.t12-card-editor select').first().waitFor({ state: 'visible', timeout: 15000 });
    assert.strictEqual(await manager.locator('.t12-traveller-editor').count(), 1);
    assert.strictEqual(await manager.locator('option[value="CATALOG_ONLY_TEST"]').count(), 1);
    assert.strictEqual(await manager.locator('[data-field="default"]').first().isChecked(), true);

    await manager.getByRole('button', { name: '+ Ajouter un voyageur' }).click();
    const newTraveller = manager.locator('.t12-traveller-editor').nth(1);
    await newTraveller.locator('[data-field="first-name"]').fill('Family');
    await newTraveller.locator('[data-field="last-name"]').fill('Member');
    await newTraveller.locator('[data-field="birth-date"]').fill('2012-03-04');
    await newTraveller.getByRole('button', { name: '+ Ajouter une carte' }).click();
    await newTraveller.locator('[data-field="card-code"]').last().selectOption('ODS_CARTE_RÉMI_LIBERTÉ_JEUNE');
    await manager.getByRole('button', { name: 'Enregistrer' }).click();
    await manager.waitFor({ state: 'detached' });

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('t12.store')));
    assert.strictEqual(stored.schemaVersion, 1);
    assert.strictEqual(stored.travellers.length, 2);
    assert.strictEqual(stored.travellers[0].firstName, 'Me');
    assert.strictEqual(stored.travellers[0].isDefault, true);
    assert.strictEqual(stored.travellers[0].cards[0].code, 'FN30');
    assert.strictEqual(stored.travellers[1].firstName, 'Family');
    assert.strictEqual(stored.travellers[1].lastName, 'Member');
    assert.strictEqual(stored.travellers[1].birthDate, '2012-03-04');
    assert.strictEqual(stored.travellers[1].isDefault, false);
    assert.strictEqual(stored.travellers[1].cards[0].code, 'ODS_CARTE_RÉMI_LIBERTÉ_JEUNE');
    assert.strictEqual(stored.travellers[1].cards[0].label, 'Carte Rémi Liberté Jeune');

    await page.click('#t12-next-train-btn');
    await requestSent;
    const params = new URLSearchParams(requestBody);
    assert.strictEqual(params.get('journey_planner_form_query_passengers[0][rank]'), '1');
    assert.strictEqual(params.get('journey_planner_form_query_passengers[0][cards][0]'), 'FN30');
    assert.strictEqual(params.has('journey_planner_form_query_passengers[1][rank]'), false);

    console.log('traveller manager, card storage, and default quick search: PASS');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

// E2E with the search POST intercepted: choose family members on results and
// verify the repeated query, selected cards, and row-specific booking autofill.
// Run: node test-traveller-selection.js
const assert = require('assert');
const { firefox } = require('playwright');
const fs = require('fs');
const path = require('path');

const STORE = {
  schemaVersion: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  travellers: [
    {
      id: 'me',
      isDefault: true,
      firstName: 'Aline',
      lastName: 'Default',
      birthDate: '1985-07-14',
      cards: [{ code: 'FN30', label: 'Carte Famille Nombreuse 30%', type: '', cardNumber: '' }],
    },
    {
      id: 'young-traveller',
      isDefault: false,
      firstName: 'Camille',
      lastName: 'Family',
      birthDate: '2012-03-04',
      cards: [{ code: 'ODS_CARTE_RÉMI_LIBERTÉ_JEUNE', label: 'Carte Rémi Liberté Jeune', type: '', cardNumber: '' }],
    },
  ],
};

function searchResponse(searchNumber) {
  return {
    rail_search_query_key: `mock-search-${searchNumber}`,
    booking_key_value: '',
    journeyPlannerNextStep: '',
    journeyPlannerCurrentStep: 'oneway-outward',
    search_results: {
      rail_search_title: 'Mocked train results',
      rail_search_results: '<div class="r-s-r"><div class="r-s-r-offers"></div></div>',
      booking_form_passengers_html: '<div class="form-content"><div class="form-error default-error"></div><input type="hidden" id="booking-form-seats"><div id="booking-form-passengers-forms"></div><button id="submit-booking" class="button submit"></button></div>',
      bookingFormIndicateNameOfPassengersTitle: 'Passenger details',
    },
  };
}

(async () => {
  const browser = await firefox.launch({ headless: true });
  try {
    const context = await browser.newContext({ timezoneId: 'Europe/Paris' });
    const page = await context.newPage();
    const requests = [];
    let resolveSecondRequest;
    const secondRequest = new Promise((resolve) => { resolveSecondRequest = resolve; });

    // Never send a train search to 12train from this test.
    await page.route('**/forms/form-sales-journey-planner-outward.php', async (route) => {
      requests.push(route.request().postData());
      if (requests.length === 2) resolveSecondRequest();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(searchResponse(requests.length)),
      });
    });

    await page.goto('https://www.12train.com/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.evaluate((store) => localStorage.setItem('t12.store', JSON.stringify(store)), STORE);
    await page.addScriptTag({
      content: fs.readFileSync(path.join(__dirname, '12train-next-train.user.js'), 'utf8'),
    });

    const managerButton = page.locator('#t12-traveller-manager-btn');
    assert.strictEqual(await managerButton.evaluate((button) => button.parentElement.id), 'header-right');

    await page.click('#t12-next-train-btn');
    await page.waitForSelector('#t12-results-travellers-btn');
    assert.strictEqual(await page.locator('#t12-results-travellers-btn').textContent(), 'Travellers · 1');
    assert.strictEqual(requests.length, 1);

    await page.click('#t12-results-travellers-btn');
    const picker = page.locator('#t12-traveller-selection');
    await picker.waitFor({ state: 'visible' });
    const checks = picker.locator('input[type="checkbox"]');
    assert.strictEqual(await checks.count(), 2);
    assert.strictEqual(await checks.nth(0).isChecked(), true);
    assert.strictEqual(await checks.nth(1).isChecked(), false);
    await checks.nth(1).check();
    await picker.getByRole('button', { name: 'Actualiser les résultats (2)' }).click();
    await secondRequest;

    assert.strictEqual(requests.length, 2);
    const first = new URLSearchParams(requests[0]);
    const second = new URLSearchParams(requests[1]);
    assert.strictEqual(second.get('form[originCode]'), first.get('form[originCode]'));
    assert.strictEqual(second.get('form[destinationCode]'), first.get('form[destinationCode]'));
    assert.strictEqual(second.get('form[departure_date]'), first.get('form[departure_date]'));
    assert.strictEqual(second.get('form[departure_hour]'), first.get('form[departure_hour]'));
    assert.strictEqual(second.get('journey_planner_form_query_passengers[0][cards][0]'), 'FN30');
    assert.strictEqual(second.get('journey_planner_form_query_passengers[1][rank]'), '2');
    assert.strictEqual(second.get('journey_planner_form_query_passengers[1][sncf_age_group_code]'), '25');
    assert.strictEqual(second.get('journey_planner_form_query_passengers[1][cards][0]'), 'ODS_CARTE_RÉMI_LIBERTÉ_JEUNE');
    await page.waitForFunction(() => document.getElementById('t12-results-travellers-btn')?.textContent === 'Travellers · 2');

    // Check that booking passenger rank maps back to the correct stored person.
    await page.evaluate(() => {
      document.getElementById('booking-form-passengers-forms').innerHTML = `
        <div class="passenger-c" data-passenger_id="1">
          <input class="first-name"><input class="last-name">
          <input class="passenger-birthdate-day"><input class="passenger-birthdate-month"><input class="passenger-birthdate-year">
        </div>
        <div class="passenger-c" data-passenger_id="2">
          <input class="first-name"><input class="last-name">
          <input class="passenger-birthdate-day"><input class="passenger-birthdate-month"><input class="passenger-birthdate-year">
        </div>`;
    });
    await page.waitForFunction(() => document.querySelector('.passenger-c[data-passenger_id="2"] .first-name')?.value === 'Camille');
    const formRows = await page.locator('#booking-form-passengers-forms .passenger-c').evaluateAll((rows) => rows.map((row) => ({
      firstName: row.querySelector('.first-name').value,
      lastName: row.querySelector('.last-name').value,
      day: row.querySelector('.passenger-birthdate-day').value,
      month: row.querySelector('.passenger-birthdate-month').value,
      year: row.querySelector('.passenger-birthdate-year').value,
    })));
    assert.deepStrictEqual(formRows, [
      { firstName: 'Aline', lastName: 'Default', day: '14', month: '07', year: '1985' },
      { firstName: 'Camille', lastName: 'Family', day: '04', month: '03', year: '2012' },
    ]);

    console.log('results-page traveller selection, re-search, and row autofill: PASS');
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

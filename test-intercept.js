const { firefox } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
  page.on('pageerror', e => console.log('PAGEERROR', e.message));

  let captured = null;
  await page.route('**/forms/form-sales-journey-planner-outward.php', async route => {
    captured = route.request().postData();
    console.log('CAPTURED BODY:\n' + captured);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"errors":[{"code":"test","message":"intercepted"}]}' });
  });

  await page.goto('https://www.12train.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  const script = fs.readFileSync(require('path').join(__dirname, '12train-next-train.user.js'), 'utf8');
  await page.addScriptTag({ content: script });
  await page.waitForTimeout(500);

  const hasBtn = await page.$('#t12-next-train-btn');
  console.log('BUTTON PRESENT:', !!hasBtn);

  await page.click('#t12-next-train-btn');
  await page.waitForTimeout(2000);

  // Inspect form state
  const state = await page.evaluate(() => ({
    origin: document.getElementById('origin').value,
    originCode: document.getElementById('origin').dataset.stationCode,
    dest: document.getElementById('destination').value,
    destCode: document.getElementById('destination').dataset.stationCode,
    date: document.getElementById('departure_date').value,
    hour: document.getElementById('departure_hour').value,
    returnDate: document.getElementById('return_date').value,
    passengers: [...document.querySelectorAll('.j-p-form-passenger-control-box')].map(b => ({
      type: b.querySelector('.rail-search-passenger-type')?.textContent,
      rank: b.querySelector('.rail-search-passenger-type')?.dataset.rank,
      ageGroup: b.querySelector('.rail-search-passenger-type')?.dataset.sncf_age_group_code,
      cards: [...b.querySelectorAll('.j-p-form-passenger-card-selected')].map(c => ({code: c.dataset.card_code, type: c.dataset.card_type, label: c.textContent})),
      numbers: [...b.querySelectorAll('.j-p-form-passenger-card-number')].map(i => i.value),
    })),
  }));
  console.log('STATE:', JSON.stringify(state, null, 2));
  console.log('CAPTURED?', captured ? 'yes' : 'no');

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

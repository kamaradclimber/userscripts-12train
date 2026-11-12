// E2E: search, click first "Réserver" offer, verify booking form auto-fill.
// Run: node test-booking-fill.js
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));

  await page.goto('https://www.12train.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  // Pre-store identity, as the user would via the gear menu.
  await page.evaluate(() => {
    localStorage.setItem('t12_first_name', 'Jean');
    localStorage.setItem('t12_last_name', 'Dupont');
    localStorage.setItem('t12_birth_date', '14/07/1985');
    localStorage.setItem('t12_card_number', '1234567890');
  });

  // Install the userscript.
  const script = fs.readFileSync(path.join(__dirname, '12train-next-train.user.js'), 'utf8');
  await page.addScriptTag({ content: script });
  await page.waitForTimeout(300);

  await page.click('#t12-next-train-btn');
  await page.waitForTimeout(6000);

  // Click the first 2nd-class price, then the revealed "Sélectionner" button.
  const priceBtn = await page.$('div.r-s-r-o-price.r-s-r-o-price-with_offer');
  if (!priceBtn) { console.log('NO PRICE BUTTON'); await browser.close(); process.exit(1); }
  await priceBtn.click();
  await page.waitForTimeout(500);

  const offerBtn = await page.$('.r-s-r-submit-sale >> visible=true');
  if (!offerBtn) { console.log('NO OFFER BUTTON'); await browser.close(); process.exit(1); }
  await offerBtn.click();
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const boxes = [...document.getElementById('booking-form-passengers-forms')?.getElementsByClassName('passenger-c') || []];
    return {
      boxCount: boxes.length,
      boxes: boxes.map(b => ({
        firstName: b.querySelector('input.first-name')?.value,
        lastName: b.querySelector('input.last-name')?.value,
        day: b.querySelector('input.passenger-birthdate-day')?.value,
        month: b.querySelector('input.passenger-birthdate-month')?.value,
        year: b.querySelector('input.passenger-birthdate-year')?.value,
        cardNumber: b.querySelector('input.passenger-card-number')?.value,
        labelsShrunk: [...b.querySelectorAll('.input-text-label')].map(l => l.className),
      })),
    };
  });
  console.log('BOOKING FORM STATE:', JSON.stringify(state, null, 2));

  const ok = state.boxCount > 0
    && state.boxes.every(b => b.firstName === 'Jean' && b.lastName === 'Dupont'
      && b.day === '14' && b.month === '07' && b.year === '1985');
  console.log(ok ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
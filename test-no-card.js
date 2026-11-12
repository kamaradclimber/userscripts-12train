const { firefox } = require('playwright');
(async () => {
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({ timezoneId: 'Europe/Paris' });
  const page = await context.newPage();
  await page.goto('https://www.12train.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const beforeNoon = new Date().getHours() < 12;
    const origin = beforeNoon
      ? { name: 'Chartres', code: 'FRQTJ' }
      : { name: 'Paris Montparnasse', code: 'FRPMO' };
    const destination = beforeNoon
      ? { name: 'Paris Montparnasse', code: 'FRPMO' }
      : { name: 'Chartres', code: 'FRQTJ' };
    const o = document.getElementById('origin'); o.value=origin.name; o.dataset.stationCode=origin.code; o.dataset.stationName=origin.name;
    const d = document.getElementById('destination'); d.value=destination.name; d.dataset.stationCode=destination.code; d.dataset.stationName=destination.name;
    const dt = document.getElementById('departure_date'); dt._flatpickr.setDate(new Date(), true);
    const hour = Math.min(23, Math.max(4, new Date().getHours()));
    document.getElementById('departure_hour').value=String(hour).padStart(2, '0');
    document.getElementById('return_date').value='';
    document.getElementById('return_hour').value='';
  });
  await page.click('#journeyplanner-form-submit');
  await page.waitForTimeout(6000);
  const text = await page.evaluate(() => document.getElementById('r-s-r-results')?.innerText.slice(0,400));
  console.log('NO-CARD RESULTS:\n' + text);
  await context.close();
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

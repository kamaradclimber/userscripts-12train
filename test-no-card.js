const { firefox } = require('playwright');
(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.12train.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const o = document.getElementById('origin'); o.value='Chartres'; o.dataset.stationCode='FRQTJ'; o.dataset.stationName='Chartres';
    const d = document.getElementById('destination'); d.value='Paris Montparnasse'; d.dataset.stationCode='FRPMO'; d.dataset.stationName='Paris Montparnasse';
    const dt = document.getElementById('departure_date'); dt._flatpickr.setDate(new Date(), true);
    document.getElementById('departure_hour').value='11';
    document.getElementById('return_date').value='';
    document.getElementById('return_hour').value='';
  });
  await page.click('#journeyplanner-form-submit');
  await page.waitForTimeout(6000);
  const text = await page.evaluate(() => document.getElementById('r-s-r-results')?.innerText.slice(0,400));
  console.log('NO-CARD RESULTS:\n' + text);
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

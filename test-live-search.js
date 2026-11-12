const { firefox } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('response', async r => {
    if (r.url().includes('form-sales-journey-planner-outward.php')) {
      console.log('RESP STATUS', r.status());
      try { console.log('RESP BODY', (await r.text()).slice(0, 600)); } catch(e) {}
    }
  });
  await page.goto('https://www.12train.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.addScriptTag({ content: fs.readFileSync(require('path').join(__dirname, '12train-next-train.user.js'),'utf8') });
  await page.waitForTimeout(300);
  await page.click('#t12-next-train-btn');
  await page.waitForTimeout(6000);
  const results = await page.evaluate(() => {
    const el = document.getElementById('r-s-r-results');
    return { hasResults: !!el, text: el ? el.innerText.slice(0, 500) : null, errors: [...document.querySelectorAll('.form-error')].map(e=>e.innerText).filter(Boolean) };
  });
  console.log('RESULTS', JSON.stringify(results, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

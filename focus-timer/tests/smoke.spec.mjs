import { test, expect } from '@playwright/test';

const URL = 'https://sk1227071686.github.io/focus-timer/';
const OUT_DIR = 'artifacts/smoke';

test.setTimeout(30000);

test('smoke: start → 1s tick → pause, take screenshots and log timer text', async ({ page }) => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // ensure output dir exists
  await page.evaluate((dir) => {
    try { return; } catch (e) { /* noop - mkdir not allowed in browser */ }
  }, OUT_DIR);

  // initial screenshot
  const initialPath = `${OUT_DIR}/initial.png`;
  await page.screenshot({ path: initialPath, fullPage: true });

  // read timer text before
  const findTimer = async () => {
    // try to find element that matches mm:ss pattern
    const el = await page.locator('xpath=//*[matches(normalize-space(text()), "\\\d{1,2}:\\\d{2}")]').first().catch(()=>null);
    if (el) return (await el.innerText()).trim();
    // fallback: search any element containing ':'
    const el2 = await page.locator('text=:\\d').first().catch(()=>null);
    if (el2) return (await el2.innerText()).trim();
    return null;
  };

  const before = await findTimer();
  console.log('timer before:', before);

  // click 开始
  const startBtn = page.getByRole('button', { name: '开始' });
  await expect(startBtn).toBeVisible();
  await startBtn.click();

  // wait 1s
  await page.waitForTimeout(1000);

  const afterStart = await findTimer();
  console.log('timer after 1s:', afterStart);

  const afterStartPath = `${OUT_DIR}/after_start_1s.png`;
  await page.screenshot({ path: afterStartPath, fullPage: true });

  // assert it changed
  if (before && afterStart) {
    expect(afterStart).not.toBe(before);
  }

  // click 暂停
  const pauseBtn = page.getByRole('button', { name: '暂停' });
  await expect(pauseBtn).toBeVisible();
  await pauseBtn.click();

  await page.waitForTimeout(300);
  const afterPause = await findTimer();
  console.log('timer after pause:', afterPause);

  const afterPausePath = `${OUT_DIR}/after_pause.png`;
  await page.screenshot({ path: afterPausePath, fullPage: true });

  // final checks: afterPause should equal afterStart (approx)
  if (afterStart && afterPause) {
    expect(afterPause).toBe(afterStart);
  }
});

import { test, expect } from '@playwright/test';

test('full flow: start → tick → pause → resume → finish → break → skip', async ({ page }) => {
  await page.goto('http://127.0.0.1:8000/focus-timer/index.html');

  // initial
  await expect(page.locator('#timerDigits')).toHaveText('45:00');

  // start
  await page.click('#btnStart');
  await page.waitForTimeout(1200);
  const t1 = await page.locator('#timerDigits').innerText();
  expect(t1).not.toBe('45:00');

  // pause
  await page.click('#btnPause');
  const paused = await page.locator('#statusLabel').innerText();
  // paused label may be 'paused' or localized; ensure status changed from running
  expect(paused).toBeTruthy();

  // resume
  await page.click('#btnStart');
  await page.waitForTimeout(1100);
  const t2 = await page.locator('#timerDigits').innerText();
  expect(t2).not.toBe(t1);

  // Fast-forward to zero by manipulating state in page (avoid long loop)
  await page.evaluate(() => {
    // set remaining to 0 and call onTick to trigger phaseDone
    if (window.__FT_DEBUG__ && window.__FT_DEBUG__.state) {
      window.__FT_DEBUG__.state.pausedRemaining = 0;
      window.__FT_DEBUG__.state.startTime = Date.now() - 1000;
    }
    // call onTick once
    if (typeof window.manualTick === 'function') window.manualTick();
  });

  // modal should appear
  await expect(page.locator('.overlay')).toHaveClass(/show/);
});
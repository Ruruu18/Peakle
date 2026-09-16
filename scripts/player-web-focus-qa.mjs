import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { installBackend, signInFixture } from './player-web-fixtures.mjs';

const baseUrl = process.env.PLAYER_WEB_URL || 'http://localhost:8081';
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  const warnings = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cdp = await page.createCDPSession();
  await cdp.send('Log.enable');
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (/Blocked aria-hidden/.test(entry.text)) warnings.push(entry.text);
  });
  await page.evaluateOnNewDocument(() => {
    window.hiddenFocusViolations = [];
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name === 'aria-hidden' && String(value) === 'true' && this.contains(document.activeElement)) {
        window.hiddenFocusViolations.push(document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.slice(0, 80));
      }
      return setAttribute.call(this, name, value);
    };
  });
  // All external requests are intercepted; this test never changes real accounts.
  await installBackend(page, baseUrl);
  await page.setViewport({ width: 390, height: 844 });
  await signInFixture(page, baseUrl);

  const assertSafeFocus = async () => {
    const state = await page.evaluate(() => ({
      hidden: Boolean(document.activeElement.closest('[aria-hidden="true"], [inert]')),
      violations: window.hiddenFocusViolations,
    }));
    assert.deepEqual(state.violations, [], 'Screens release focus before aria-hidden is applied');
    assert.equal(state.hidden, false, 'Focus stays in visible, interactive content');
    // Force an accessibility snapshot so Chrome also reports blocked aria-hidden.
    await cdp.send('Accessibility.getFullAXTree');
    assert.deepEqual(warnings, [], 'Chrome reports no blocked aria-hidden warnings');
  };
  const expectSceneFocus = async () => {
    await page.waitForFunction(() => document.activeElement.matches('[data-browser-scene]:not([inert])'));
    await assertSafeFocus();
  };

  await page.locator('[aria-label="Open leaderboard"]').click();
  await page.waitForFunction(() => location.pathname === '/leaderboard');
  await assertSafeFocus();
  await expectSceneFocus();

  // Inactive screens stay mounted, but cannot receive programmatic or Tab focus.
  assert.equal(await page.evaluate(() => {
    const trigger = document.querySelector('[aria-label="Open leaderboard"]');
    const active = document.activeElement;
    trigger.focus();
    return trigger.isConnected && document.activeElement === active && Boolean(trigger.closest('[inert]'));
  }), true, 'Inactive screens preserve their DOM and reject focus');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Go back', 'Tab starts at the destination screen');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/');
  await expectSceneFocus();

  // Repeat the transition using the keyboard after the lazy screen has mounted.
  await page.focus('[aria-label="Open leaderboard"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/leaderboard');
  await expectSceneFocus();
  await page.focus('[aria-label="Refresh leaderboard"]');
  await page.goBack();
  await page.waitForFunction(() => location.pathname === '/');
  await expectSceneFocus();
  await page.focus('[aria-label="Open leaderboard"]');
  await page.goForward();
  await page.waitForFunction(() => location.pathname === '/leaderboard');
  await expectSceneFocus();

  // The tab bar remains visible across routes and should retain its own focus.
  await page.locator('[aria-label="Home tab"]').click();
  await page.waitForFunction(() => location.pathname === '/');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Home tab');
  await assertSafeFocus();

  // Opening and closing an overlay does not change routes or invoke scene focus.
  await page.locator('[aria-label="Change search location"]').click();
  await page.waitForSelector('[aria-modal="true"]');
  await page.waitForFunction(() => Boolean(document.activeElement.closest('[aria-modal="true"]')));
  await assertSafeFocus();
  await page.keyboard.press('Escape');
  await page.waitForSelector('[aria-modal="true"]', { hidden: true });
  await page.waitForFunction(() => document.activeElement.getAttribute('aria-label') === 'Change search location');
  await assertSafeFocus();
  assert.deepEqual(errors, [], 'No browser exceptions');
  console.log('Navigation focus passed: mouse, keyboard, lazy screens, history, tabs, inert scenes, and modal focus. All external requests intercepted.');
} finally {
  await browser.close();
}

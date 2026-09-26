import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { installBackend, signInFixture, userId, profile } from './player-web-fixtures.mjs';

const baseUrl = process.env.PLAYER_BETA_BASE_URL || 'http://localhost:8081';
const artifacts = '/private/tmp/peakle-schedule-activities-review';
mkdirSync(artifacts, { recursive: true });
const tomorrow = new Date(Date.now() + 86400000);
const format = options => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', ...options }).format(tomorrow);
const pickerDate = format({ weekday: 'long', month: 'long', day: 'numeric' });
const calendarDate = format({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const types = [
  ['game', 'Game', 'Games', 320], ['open_play', 'Open play', 'Open play', 390],
  ['competition', 'Tournament', 'Tournaments', 1024], ['program', 'Program', 'Programs', 1440],
];
let rows = [];
let failNextSave = false;
const saves = [];
const errors = [];
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', error => errors.push(error.message));
const click = async label => page.locator(`[aria-label="${label}"]`).click();
const text = async value => page.locator(`::-p-text(${value})`).click();
const settle = () => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
const checkLayout = async () => {
  const overflowing = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] div')]
    .filter(el => el.checkVisibility() && !['hidden', 'scroll', 'auto'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 2)
    .map(el => ({ text: el.innerText.slice(0, 80), width: el.clientWidth, scroll: el.scrollWidth })));
  assert.deepEqual(overflowing, [], 'Activity form fits without horizontal clipping');
};

try {
  await installBackend(page, baseUrl, async ({ request, resource, body, reply }) => {
    if (resource === 'scheduled_games') { await reply(request, rows); return true; }
    if (resource === 'create_scheduled_activity') {
      if (failNextSave) { failNextSave = false; await reply(request, { message: 'Could not save this activity. Try again.' }, 400); return true; }
      saves.push(body);
      const row = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'p_invitee_ids').map(([key, value]) => [key.slice(2), value]));
      Object.assign(row, { id: `activity-${rows.length}`, host_id: userId, status: 'scheduled', scheduled_game_players: [{ user_id: userId, status: 'going', profile }] });
      rows.push(row);
      await reply(request, row);
      return true;
    }
    if (resource === 'cancel_scheduled_game') {
      const row = rows.find(row => row.id === body.p_game_id);
      row.status = 'cancelled';
      await reply(request, row);
      return true;
    }
    return false;
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await signInFixture(page, baseUrl);
  await click('Schedule tab');

  for (const [kind, name, legend, width] of types) {
    await page.setViewport({ width, height: width >= 1024 ? 1000 : 844 });
    await settle();
    if (kind === 'competition') await click('Show Tournaments');
    await click('Schedule a new activity');
    await page.locator(`[role="radio"][aria-label="${name}"]`).click();
    await page.waitForSelector(`[role="radio"][aria-label="${name}"][aria-checked="true"]`);
    await checkLayout();
    await page.screenshot({ path: `${artifacts}/type-${width}.png` });
    await page.locator(`[role="dialog"] [aria-label="${pickerDate}"]`).click();
    await page.locator('[aria-label="Start time"]').fill('5:00');
    await click('Continue to activity details');
    if (kind === 'game') await page.waitForSelector('[aria-label="Match format"]');
    else {
      assert.equal(await page.$('[aria-label="Match mode"]'), null);
      await page.locator('[aria-label="Player limit"] [aria-label="8 players"]').click();
    }
    await text('Where are you playing?');
    await text('Add a court');
    await page.locator('input[placeholder="e.g. Barangay San Antonio Covered Court"]').fill('Community Courts');
    await text('Use this court');
    await page.waitForFunction(() => !document.querySelector('[data-testid="court-picker-sheet"]'));
    await click('Activity title');
    await page.type('[aria-label="Activity title"]', `QA ${name}`, { delay: 20 });
    await click('Note for players');
    await page.type('[aria-label="Note for players"]', `Bring balls for ${name.toLowerCase()}.`, { delay: 20 });
    await settle();
    await checkLayout();
    if (kind === 'program') failNextSave = true;
    await click('Save activity');
    if (kind === 'program') {
      await page.waitForSelector('::-p-text(Could not save this activity. Try again.)');
      assert.equal(await page.$eval('[aria-label="Activity title"]', el => el.value), 'QA Program');
      await click('Save activity');
    }
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    const entrySelector = `[data-desktop-layout="schedule-agenda"] [aria-label^="${legend}: QA ${name},"]`;
    await page.waitForSelector(entrySelector);
    assert.equal(saves.at(-1).p_activity_kind, kind);
    assert.equal(saves.at(-1).p_capacity, kind === 'game' ? 4 : 8);
    await page.locator(entrySelector).click();
    await page.waitForSelector(`[role="dialog"]`);
    const details = await page.$eval('[role="dialog"]', el => el.innerText);
    assert.ok(details.includes(`Bring balls for ${name.toLowerCase()}.`));
    assert.ok(!details.includes('All day'), 'Player tournaments retain their chosen time');
    if (kind !== 'game') assert.ok(!details.includes('Start match') && !details.includes('Start opens') && !details.includes('View event'), 'Typed activities use player activity details');
    await click('Close');
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-desktop-layout="schedule-calendar"]');
    await page.locator(`[data-desktop-layout="schedule-calendar"] [aria-label^="${calendarDate}"]`).click();
    await page.waitForSelector(entrySelector);
    console.log(`PASS ${name}: creation, saved type, details and reload at ${width}px`);
  }

  await page.setViewport({ width: 390, height: 844 });
  await settle();
  const colors = await page.$eval(`[data-desktop-layout="schedule-calendar"] [aria-label^="${calendarDate}"]`, day => [...day.querySelectorAll('div')].filter(el => {
    const r = el.getBoundingClientRect(); return r.width === 4 && r.height === 4;
  }).map(el => getComputedStyle(el).backgroundColor));
  assert.equal(new Set(colors).size, 4, 'The date has four distinct category markers');
  for (const [, name, legend] of types) {
    await click(`Show ${legend}`);
    await settle();
    assert.equal(await page.$(`[data-desktop-layout="schedule-agenda"] [aria-label^="${legend}: QA ${name},"]`), null);
    await click(`Show ${legend}`);
  }
  await page.evaluate(() => localStorage.setItem('@peakle/color-mode', 'dark'));
  await page.reload({ waitUntil: 'networkidle2' });
  await click('Schedule a new activity');
  await page.locator('[role="radio"][aria-label="Tournament"]').click();
  await checkLayout();
  await page.screenshot({ path: `${artifacts}/dark-type-390.png` });
  await click('Close');
  await page.locator(`[data-desktop-layout="schedule-calendar"] [aria-label^="${calendarDate}"]`).click();
  await page.locator('[data-desktop-layout="schedule-agenda"] [aria-label^="Programs: QA Program,"]').click();
  await text('Cancel activity');
  await text('Cancel activity');
  await page.waitForSelector('::-p-text(PROGRAM · CANCELLED)');
  assert.equal(rows.find(row => row.activity_kind === 'program').status, 'cancelled');
  await click('Close');
  rows = rows.filter(row => row.activity_kind === 'competition');
  await click('Home tab');
  await page.waitForSelector('[aria-label^="Next up: QA Tournament,"]');
  await page.locator('[aria-label^="Next up: QA Tournament,"]').click();
  await page.waitForSelector('[role="dialog"]');
  assert.ok((await page.$eval('[role="dialog"]', el => el.innerText)).includes('QA Tournament'));
  assert.deepEqual(errors, []);
  console.log('PASS all calendar markers, filters, save retry, dark mode, cancellation and Home routing');
} catch (error) {
  console.error('Submitted activities', saves);
  await page.screenshot({ path: `${artifacts}/failure.png` });
  console.error(await page.evaluate(() => document.body.innerText));
  throw error;
} finally {
  await browser.close();
}

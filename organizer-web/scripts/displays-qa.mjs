import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer';

const baseUrl = process.env.PORTAL_BASE_URL || 'http://localhost:3000';
const artifacts = '/private/tmp/peakle-displays-qa';
mkdirSync(artifacts, { recursive: true });
const browser = await puppeteer.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
const pages = [];
const checks = [];
const record = (text) => { checks.push(text); console.log('PASS', text); };
const fixtureTokens = ['a'.repeat(64), 'b'.repeat(64)];
const fixture = (court) => ({ available: true, fetched_at: new Date().toISOString(), display: { id: `display-${court}`, name: `Court ${court} TV`, mode: 'court', revision: 1 }, event: { name: 'Community Cup', kind: 'tournament', status: 'active', division: 'Open Singles' }, courts: [{ id: `court-${court}`, name: `Court ${court}`, match: { id: `match-${court}`, status: 'live', home: `Home Players ${court}`, away: `Away Players ${court}`, home_score: court === 1 ? 7 : 3, away_score: court === 1 ? 4 : 9, server_side: 0, service_number: 1, game: 2, games: [] } }], bracket: [], standings: [] });
const snapshots = new Map([[fixtureTokens[0], fixture(1)], [fixtureTokens[1], fixture(2)]]);
const viewerRequests = [];

async function newPage(context = browser, viewer = false) {
  const page = await context.newPage(); pages.push(page);
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(baseUrl).origin || ['data:', 'blob:'].includes(url.protocol)) return void request.continue();
    let result = [];
    if (viewer) {
      viewerRequests.push({ method: request.method(), path: url.pathname });
      if (url.pathname.endsWith('/rpc/get_scoreboard_display') && request.method() === 'POST') result = snapshots.get(JSON.parse(request.postData()).p_token) || { available: false };
    }
    await request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(result) });
  });
  return page;
}
const click = async (page, text, scope = 'button') => {
  await page.bringToFront();
  const handle = await page.waitForFunction((text, scope) => [...document.querySelectorAll(scope)].find((element) => element.textContent.trim() === text && !element.disabled), {}, text, scope);
  await handle.asElement().click(); await handle.dispose();
};
const waitText = (page, text) => page.waitForFunction((text) => document.body.innerText.includes(text), { polling: 200 }, text);
const courtName = async (page, name) => page.waitForFunction((name) => document.querySelector('.scoreboard-court h2')?.textContent === name, { polling: 200 }, name);
const layout = async (page, name) => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no horizontal page overflow`);
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
};

try {
  const manager = await newPage();
  await manager.setViewport({ width: 1440, height: 1000 });
  await manager.evaluateOnNewDocument(() => { sessionStorage.setItem('peakle-organizer-demo', '1'); localStorage.setItem('peakle-organizer-theme', 'light'); });
  await manager.goto(`${baseUrl}/monitor`, { waitUntil: 'networkidle2' });
  await click(manager, 'Full-screen monitor');
  await manager.click('[aria-label="Monitor settings"]');
  await manager.waitForSelector('.monitor-controls .display-settings-panel');
  await layout(manager, 'fullscreen-settings-placement');
  await click(manager, 'Manage displays');
  await manager.waitForSelector('.display-settings-dialog[open]');
  const reopenSettings = async () => {
    await manager.bringToFront();
    if (await manager.$('.display-settings-dialog[open]')) return;
    if (!await manager.$('.monitor-zoom')) await click(manager, 'Full-screen monitor');
    await manager.click('[aria-label="Monitor settings"]');
    await click(manager, 'Manage displays');
    await manager.waitForSelector('.display-settings-dialog[open]');
  };
  const add = async (name, courtIndex) => {
    await click(manager, 'Add display');
    await manager.locator('#display-name').fill(name);
    await manager.waitForFunction(() => document.querySelector('#display-court')?.options.length > 2);
    const court = await manager.$eval('#display-court', (select, index) => select.options[index].value, courtIndex);
    await manager.select('#display-court', court);
    await click(manager, 'Create display');
    await manager.waitForSelector('.display-editor', { hidden: true });
    return manager.evaluate((name) => [...document.querySelectorAll('.display-list-item')].find((element) => element.querySelector('h3').textContent === name).querySelector('a').href, name);
  };
  const firstLink = await add('Court 1 TV', 1);
  const secondLink = await add('Court 2 TV', 2);
  const display1 = await newPage(); const display2 = await newPage();
  await display1.goto(firstLink); await display2.goto(secondLink);
  await courtName(display1, 'Center Court'); await courtName(display2, 'Court 2');
  assert.equal(await display1.$('[aria-label="Close display settings"]'), null);
  assert.equal(await display1.$('.portal-sidebar'), null);
  await layout(display1, 'court-1-tv'); await layout(display2, 'court-2-idle');
  await click(display1, 'Full screen');
  await display1.waitForFunction(() => Boolean(document.fullscreenElement));
  await click(display1, 'Exit');
  record('Two independent display links, court-only layouts and fullscreen');

  await reopenSettings();
  await click(manager, 'Edit settings', '.display-list-item:first-child button');
  const court2 = await manager.$eval('#display-court', (select) => [...select.options].find((option) => option.textContent === 'Court 2').value);
  await manager.select('#display-court', court2);
  await manager.locator('#display-name').fill('Court 1 reassigned');
  await click(manager, 'Save display');
  await manager.waitForSelector('.display-editor', { hidden: true });
  await courtName(display1, 'Court 2');
  await courtName(display2, 'Court 2');
  await waitText(display2, 'Demo · Court 2 TV');
  await display1.reload(); await courtName(display1, 'Court 2');
  record('Central court reassignment persists after refresh and leaves other displays unchanged');
  await click(manager, 'Disconnect', '.display-list-item:last-child button');
  await click(manager, 'Disconnect display', '.display-confirm button');
  await waitText(display1, 'Display disconnected');
  await courtName(display2, 'Court 2');
  record('Disconnect clears the targeted screen without affecting another display');
  await click(manager, 'Delete', '.display-list-item:last-child button');
  await click(manager, 'Delete display', '.display-confirm button');
  await manager.waitForFunction(() => document.querySelectorAll('.display-list-item').length === 1);
  await courtName(display2, 'Court 2');
  record('Delete removes saved display settings and leaves other displays intact');

  await click(manager, 'Add display');
  await manager.locator('#display-name').fill('Tournament TV');
  await manager.select('#display-source', 'competition:demo-founders-cup');
  await manager.waitForFunction(() => document.querySelector('#display-court')?.options.length > 2 && document.querySelector('#display-division')?.options.length > 1);
  await manager.select('#display-court', 'demo-court-2');
  await manager.click('.display-assignments summary');
  const assignmentSelector = '.display-assignment select';
  await manager.waitForSelector(assignmentSelector);
  await manager.select(assignmentSelector, 'demo-court-3');
  await waitText(manager, 'Match court updated.');
  await manager.select('#display-court', 'demo-court-3');
  await click(manager, 'Create display');
  await manager.waitForSelector('.display-editor', { hidden: true });
  const competitionLink = await manager.$eval('.display-list-item:last-child a', (link) => link.href);
  const tournament = await newPage(); await tournament.goto(competitionLink);
  await courtName(tournament, 'Court 3');
  await tournament.waitForFunction(() => document.querySelector('[aria-label="Home score"]')?.textContent === '7');
  await layout(tournament, 'tournament-court');
  await reopenSettings();
  await click(manager, 'Edit settings', '.display-list-item:last-child button');
  await manager.select('#display-mode', 'bracket');
  await manager.select('#display-division', 'demo-open-division');
  await click(manager, 'Save display');
  await tournament.waitForSelector('.scoreboard-bracket-match');
  await layout(tournament, 'tournament-bracket');
  await reopenSettings();
  await click(manager, 'Edit settings', '.display-list-item:last-child button');
  await manager.select('#display-mode', 'standings');
  await click(manager, 'Save display');
  await tournament.waitForSelector('.scoreboard-standings tbody tr');
  await layout(tournament, 'division-standings');
  record('Competition court assignments, bracket and standings update an existing screen');
  await reopenSettings();
  await manager.setViewport({ width: 390, height: 844 });
  await layout(manager, 'manage-mobile');
  await click(manager, 'Edit settings', '.display-list-item:last-child button');
  await layout(manager, 'edit-mobile');

  // Independent browser contexts exercise the anonymous production transport.
  const context1 = await browser.createBrowserContext(); const context2 = await browser.createBrowserContext();
  const tv1 = await newPage(context1, true); const tv2 = await newPage(context2, true);
  await tv1.goto(`${baseUrl}/display#${fixtureTokens[0]}`); await tv2.goto(`${baseUrl}/display#${fixtureTokens[1]}`);
  await courtName(tv1, 'Court 1'); await courtName(tv2, 'Court 2');
  snapshots.get(fixtureTokens[0]).courts[0].match.home_score = 8;
  await tv1.waitForFunction(() => document.querySelector('[aria-label="Home score"]')?.textContent === '8');
  assert.equal(await tv2.$eval('[aria-label="Home score"]', (score) => score.textContent), '3');
  await tv1.setOfflineMode(true); await waitText(tv1, 'Reconnecting');
  assert.equal(await tv1.$eval('[aria-label="Home score"]', (score) => score.textContent), '8');
  snapshots.get(fixtureTokens[0]).courts[0].match.home_score = 10;
  await tv1.setOfflineMode(false);
  await tv1.waitForFunction(() => document.querySelector('[aria-label="Home score"]')?.textContent === '10');
  await waitText(tv1, 'Connected · updates automatically');
  snapshots.get(fixtureTokens[0]).courts[0].match = null;
  await waitText(tv1, 'Waiting for next match');
  snapshots.get(fixtureTokens[0]).courts[0].match = { ...fixture(1).courts[0].match, id: 'next-match', home: 'Next Home', home_score: 0 };
  await waitText(tv1, 'Next Home');
  await tv1.reload(); await waitText(tv1, 'Next Home');
  record('Separate browser contexts receive only their court updates, retain stale scores offline, recover and follow the next match');
  for (const [name, width, height] of [['tv-1080p',1920,1080],['laptop',1366,768],['portrait',768,1024],['phone',390,844]]) {
    await tv1.setViewport({ width, height }); await layout(tv1, name);
    const fits = await tv1.$eval('.scoreboard-court', (court) => { const rect = court.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; });
    assert.ok(fits, `${name}: court scoreboard fits the screen`);
  }
  snapshots.delete(fixtureTokens[0]); await waitText(tv1, 'Display disconnected');
  assert.equal(await tv1.$('.scoreboard-score'), null);
  await courtName(tv2, 'Court 2');
  assert.ok(viewerRequests.every((request) => request.path.endsWith('/rpc/get_scoreboard_display')), 'Public displays never load organizer auth or unrelated tables');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors, artifacts }, null, 2));
} catch (error) {
  for (const [index, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: `${artifacts}/failure-${index}.png`, fullPage: true }).catch(() => {});
  console.error({ checks, errors }); throw error;
} finally { await browser.close(); }

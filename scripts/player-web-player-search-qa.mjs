import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { installBackend, signInFixture } from './player-web-fixtures.mjs';

const baseUrl = process.env.PLAYER_WEB_URL || 'http://localhost:8081';
const artifacts = join(tmpdir(), 'peakle-player-search-qa');
mkdirSync(artifacts, { recursive: true });
const players = [
  { id: '22222222-2222-4222-8222-222222222222', display_name: 'Alex Player', home_area: 'Manila', skill_rating: 3.2 },
  { id: '33333333-3333-4333-8333-333333333333', display_name: 'Sam Player', home_area: 'Cebu', skill_rating: null },
];
const following = new Set();
const followWrites = [];
let failSearch = false;
let failFollow = false;
let releaseSlowSearch;
let markSlowSearchStarted;
const scene = '[data-browser-scene]:not([inert])';
const browser = await puppeteer.launch({ headless: true });
let page;
try {
  page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Every external request is intercepted. Following changes only these fixtures.
  const backend = await installBackend(page, baseUrl, async ({ request, resource, body, reply: sendReply }) => {
    const reply = async (data, status) => { await sendReply(request, data, status); return true; };
    const permission = (id) => ({ is_following: following.has(id), follows_you: id === players[1].id, can_message: false });
    if (resource === 'search_direct_message_candidates') {
      if (failSearch) return reply({ message: 'Simulated search outage' }, 503);
      const needle = body.p_query.toLowerCase();
      if (needle === 'slow') {
        await new Promise((resolve) => { releaseSlowSearch = resolve; markSlowSearchStarted(); });
        return reply([{ ...players[0], ...permission(players[0].id) }]);
      }
      return reply(players.filter((player) => player.display_name.toLowerCase().includes(needle)).map((player) => ({ ...player, ...permission(player.id) })));
    }
    if (resource === 'follow_player') {
      if (failFollow) return reply({ message: 'Simulated follow failure' }, 503);
      followWrites.push(body.p_player_id);
      following.add(body.p_player_id);
      return reply(null);
    }
    if (resource === 'get_direct_message_permission') return reply(permission(body.p_player_id));
    if (resource === 'get_public_player_profile') return reply(players.filter((player) => player.id === body.p_player_id));
    return false;
  });
  await page.setViewport({ width: 390, height: 844 });
  await signInFixture(page, baseUrl);
  const clickLabel = (label) => page.locator(`${scene} [aria-label="${label}"]`).click();
  const input = () => page.locator(`${scene} input[aria-label="Search players by name"]`);
  const waitText = (text) => page.waitForFunction((selector, value) => document.querySelector(selector)?.innerText.includes(value), {}, scene, text);
  const visible = (selector) => page.$eval(selector, (element) => {
    const bounds = element.getBoundingClientRect();
    return element.checkVisibility() && bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth;
  });

  assert.ok(await visible('[aria-label="Search players"]'), 'Home entry is visible without scrolling');
  await page.screenshot({ path: join(artifacts, 'home-phone.png') });
  await clickLabel('Search players');
  await page.waitForFunction(() => location.pathname === '/players');
  await waitText('Find players to follow');
  await input().fill('A');
  await waitText('Type at least 2 letters');
  assert.equal(backend.requests.filter((request) => request.resource === 'search_direct_message_candidates').length, 0, 'One letter does not request a search');
  await input().fill('Player');
  await page.waitForSelector(`${scene} [aria-label="Follow Alex Player"]`);
  await page.waitForSelector(`${scene} [aria-label="Follow back Sam Player"]`);
  assert.ok(await visible(`${scene} [aria-label="Follow back Sam Player"]`), 'Players in another city can be followed');

  for (const [name, width, height] of [['phone', 390, 844], ['narrow-phone', 320, 740], ['desktop', 1440, 1000]]) {
    await page.setViewport({ width, height });
    assert.ok(await visible(`${scene} [aria-label="Follow Alex Player"]`), `${name}: follow action fits`);
    const overflow = await page.$eval(scene, (element) => element.scrollWidth > element.clientWidth + 1);
    assert.equal(overflow, false, `${name}: no horizontal overflow`);
    await page.screenshot({ path: join(artifacts, `search-${name}.png`) });
  }

  await clickLabel('Follow Alex Player');
  await page.waitForSelector(`${scene} [aria-label="Following Alex Player"][aria-disabled="true"]`);
  assert.deepEqual(followWrites, [players[0].id], 'Follow writes to the selected player once');
  failFollow = true;
  await clickLabel('Follow back Sam Player');
  await waitText('Could not follow Sam Player');
  failFollow = false;
  await clickLabel('Follow back Sam Player');
  await page.waitForSelector(`${scene} [aria-label="Following Sam Player"]`);
  assert.deepEqual(followWrites, players.map((player) => player.id), 'Follow can be retried after failure');

  await clickLabel("View Alex Player's profile");
  await page.waitForFunction((id) => location.pathname === `/players/${id}`, {}, players[0].id);
  await waitText('Alex Player');
  // Simulate a relationship change while viewing the profile; returning must refresh it.
  following.delete(players[0].id);
  await clickLabel('Go back');
  await page.waitForSelector(`${scene} [aria-label="Follow Alex Player"]`);
  assert.equal(await page.$eval(`${scene} input`, (element) => element.value), 'Player', 'Returning preserves the query');

  await input().fill('Nobody');
  await waitText('No players found');
  failSearch = true;
  await input().fill('Alex');
  await waitText('Search unavailable');
  failSearch = false;
  await page.locator(`${scene} ::-p-text(Try again)`).click();
  await page.waitForSelector(`${scene} [aria-label="Follow Alex Player"]`);

  const slowRequest = new Promise((resolve) => { markSlowSearchStarted = resolve; });
  await input().fill('slow');
  await slowRequest;
  await input().fill('Sam');
  await page.waitForSelector(`${scene} [aria-label="Following Sam Player"]`);
  const slowResponse = page.waitForResponse((response) => response.request().postData()?.includes('slow'));
  releaseSlowSearch();
  await slowResponse;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.$(`${scene} [aria-label="Follow Alex Player"]`), null, 'An older search cannot replace newer results');

  await clickLabel('Clear player search');
  await waitText('Find players to follow');
  await clickLabel('Go back');
  await page.waitForFunction(() => location.pathname === '/');
  await clickLabel('Use dark dashboard');
  await clickLabel('Search players');
  await input().fill('Player');
  await page.waitForSelector(`${scene} [aria-label="Follow Alex Player"]`);
  await page.screenshot({ path: join(artifacts, 'search-dark-desktop.png') });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, 'search-dark-phone.png') });
  await page.reload();
  await page.waitForSelector(`${scene} input[aria-label="Search players by name"]`);
  assert.equal(new URL(page.url()).pathname, '/players', 'Direct search links survive reload');
  assert.deepEqual(errors, [], 'No browser exceptions');
  console.log(`PASS Home discovery, search, profiles, follow/back, errors/retry, stale results, clearing, direct links, phone/desktop, and dark mode. Screenshots: ${artifacts}`);
} catch (error) {
  releaseSlowSearch?.();
  if (page) {
    console.error(await page.evaluate((selector) => document.querySelector(selector)?.innerText || document.body.innerText, scene));
    await page.screenshot({ path: join(artifacts, 'failure.png') });
  }
  throw error;
} finally {
  await browser.close();
}

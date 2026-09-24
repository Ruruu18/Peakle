import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installBackend, signInFixture, competitionId, divisionId, sessionId } from './player-web-fixtures.mjs';
import { checkDesktopLayouts } from './player-web-desktop-checks.mjs';
const flowViewport = process.argv.includes('--desktop-flows') ? { width: 1440, height: 1000 } : { width: 390, height: 844 };
const baseUrl = process.env.PLAYER_WEB_URL || 'http://localhost:8081';
const viewports = [['small-phone', 320, 568], ['phone', 390, 844], ['tablet', 768, 1024], ['before-desktop', 1023, 768], ['desktop-breakpoint', 1024, 768], ['laptop', 1280, 800], ['desktop', 1440, 1000]];
const browser = await puppeteer.launch({ headless: true });
const artifacts = join(tmpdir(), 'peakle-player-web-qa');
mkdirSync(artifacts, { recursive: true });
const errors = [];
const compatibilityWarnings = [];
const checkConsole = (message) => {
  const text = message.text();
  if (/\[expo-notifications\]|useNativeDriver.*not supported|Node cannot be found in the current page|Blocked aria-hidden/.test(text)) {
    compatibilityWarnings.push(text);
  }
};
let player;
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', checkConsole);
  // This harness must never create users or change records in the real backend.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === new URL(baseUrl).origin || ['data:', 'blob:'].includes(url.protocol)) return void request.continue();
    return void request.respond({ status: 200, contentType: 'application/json', body: '[]', headers: { 'access-control-allow-origin': '*' } });
  });
  for (const [name, width, height] of (process.argv.includes('--flows-only') ? [] : viewports)) {
    await page.setViewport({ width, height });
    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input', { timeout: 15000 });
    assert.ok(await page.$('.beta-banner'), 'Browser entry and beta shell loaded');
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, text: document.body.innerText.slice(0, 1400), placeholders: [...document.querySelectorAll('input')].map((input) => input.placeholder) }));
    assert.ok(dimensions.width <= width, `${name}: no page overflow`);
    await page.screenshot({ path: `${artifacts}/peakle-beta-${name}.png`, fullPage: true });
    console.log('Login layout passed:', name, width);
  }
  await page.close();
  player = await browser.newPage();
  player.on('pageerror', (error) => { errors.push(error.message); console.error('Browser error:', error.message); });
  player.on('console', checkConsole);
  const backend = await installBackend(player, baseUrl);
  await player.setViewport(flowViewport);
  await signInFixture(player, baseUrl);
  assert.ok(backend.requests.some(r => r.resource === 'token' && r.body.grant_type !== 'refresh_token'), 'Password login reaches the auth API');
  console.log('Password login passed');
  if (process.argv.includes('--desktop-flows')) await checkDesktopLayouts(player, backend, baseUrl, artifacts);
  for (const path of (process.argv.includes('--flows-only') ? [] : ['/', '/teams', '/explore', '/play', '/compete', '/leaderboard', '/profile', '/activities', '/privacy', '/legal/privacy', '/legal/terms', '/account-deletion', '/payment-history', '/help', '/support', '/chats', '/connections', '/players/11111111-1111-4111-8111-111111111111', `/activities/competition/${competitionId}`, `/chats/competition/${competitionId}`, `/competitions/${competitionId}/divisions/${divisionId}`, `/sessions/${sessionId}`])) {
    await player.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle2' });
    await player.waitForSelector('[aria-label="Play tab"]');
    if (path === '/teams') await player.waitForSelector('[aria-label="Open Community Clan chat"]', { timeout: 15000 });
    if (path === '/compete') await player.waitForSelector('::-p-text(Register in division)', { timeout: 15000 });
    if (path.startsWith('/sessions/')) await player.waitForSelector('::-p-text(Join session)', { timeout: 15000 });
    for (const [name, width, height] of viewports) {
      await player.setViewport({ width, height });
      // Let React process the window resize and the app column's ResizeObserver.
      await player.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await player.evaluate(() => {
        const shell = document.querySelector('.beta-shell').getBoundingClientRect();
        const tab = document.querySelector('[aria-label="Play tab"]').getBoundingClientRect();
        const overflowingScrollViews = [...document.querySelectorAll('.beta-app div')].filter((element) => {
          const style = getComputedStyle(element);
          return element.checkVisibility() && ['auto', 'scroll'].includes(style.overflowY)
            && style.overflowX === 'hidden' && element.scrollWidth > element.clientWidth + 1;
        }).map((element) => ({ width: element.clientWidth, contentWidth: element.scrollWidth, text: element.innerText.slice(0, 120) }));
        const scene = document.querySelector('[data-browser-scene]:not([inert])').getBoundingClientRect();
        const navigation = document.querySelector('[data-player-navigation]').getBoundingClientRect();
        return { sceneLeft: scene.left, sceneWidth: scene.width, navigationRight: navigation.right, navigationWidth: navigation.width, navigationHeight: navigation.height, left: shell.left, right: shell.right, width: shell.width, pageWidth: document.documentElement.scrollWidth, tabBottom: tab.bottom, tabRight: tab.right, overflowingScrollViews };
      });
      assert.ok(layout.left >= 0 && layout.right <= width + 1 && layout.width <= (width >= 1024 ? width : 561) && layout.pageWidth <= width + 1, `${path} at ${name}: app fits its column`);
      if (width >= 1024) {
        assert.ok(layout.navigationWidth === 224 && layout.navigationHeight > height - 60, `${path} at ${name}: sidebar fills the left edge`);
        assert.ok(layout.sceneLeft >= layout.navigationRight && layout.sceneWidth >= 790 && layout.sceneWidth <= 1041, `${path} at ${name}: content widens without overlapping navigation`);
      }
      assert.ok(layout.tabRight <= layout.right + 1 && layout.tabBottom <= height + 1, `${path} at ${name}: navigation stays visible`);
      assert.deepEqual(layout.overflowingScrollViews, [], `${path} at ${name}: vertical content is not clipped horizontally`);
      await player.screenshot({ path: `${artifacts}/peakle-beta-auth-${path.split('/')[1] || 'home'}-${name}.png`, fullPage: true });
    }
    console.log('Route loaded:', path);
    assert.equal(await player.$('[aria-label="Open messages"]'), null);
  }
  await player.setViewport(flowViewport);
  const clickText = (text) => player.locator(`::-p-text(${text})`).click();
  const clickLabel = async (label) => { const selector = `[aria-label="${label}"]:not([aria-disabled="true"])`; await player.waitForSelector(selector); await player.locator(selector).click(); };
  const go = async (path) => { await player.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle2' }); await player.waitForSelector('[aria-label="Play tab"]'); };
  await go('/teams');
  await player.locator('[aria-label="Open Community Clan chat"]').click();
  await player.locator('textarea[placeholder="Message Community Clan"]').fill('Ready for our community tournament!');
  const messageSaved = player.waitForResponse(r => r.url().includes('/team_messages') && r.request().method() === 'POST');
  await player.locator('[aria-label="Send message"]').click();
  await messageSaved;
  await player.waitForFunction(() => document.body.innerText.includes('Ready for our community tournament!'));
  assert.equal(backend.groupMessages.length, 1, 'Group message saved through the shared backend');
  await player.screenshot({ path: `${artifacts}/peakle-beta-group-chat.png` });
  console.log('Group message sent');
  await go('/compete');
  await clickText('Register in division');
  await player.waitForSelector('dialog[open]');
  await player.locator('dialog button').click();
  assert.equal(backend.division.competition_entries.length, 1, 'Tournament registration persisted');
  await player.reload({ waitUntil: 'networkidle2' });
  await player.waitForSelector('::-p-text(Registered in this division.)');
  console.log('Tournament registration survives refresh');
  await go(`/sessions/${sessionId}`);
  await clickText('Join session');
  await clickText('Check in now');
  await player.waitForFunction(() => document.body.innerText.includes('You’re in the queue'));
  assert.ok(backend.openPlay.my_registration.checked_in_at);
  console.log('Open-play join and check-in saved');
  await go('/play');
  await player.locator('[aria-label="Set up a match"]').click();
  await clickText('Singles');
  await clickText('Continue to players');
  await clickText('Guest names');
  await player.locator('[aria-label="Team 1 player 1"]').fill('Beta Test Player');
  await player.locator('[aria-label="Team 2 player 1"]').fill('Alex Guest');
  await clickText('Continue to court');
  await player.locator('[aria-label="Choose a booked court"]').click();
  await clickText('Community Court 1');
  await clickText('Review match');
  await clickText('Continue to first serve');
  await player.locator('[aria-label="Choose Beta Test Player to serve first"]').click();
  await clickText('Start with Beta Test Player');
  await player.waitForSelector('[aria-label="Team 1 score 0"]');
  await clickLabel('Beta Test Player won the rally');
  await player.waitForSelector('[aria-label="Team 1 score 1"]');
  const pausedSaved = player.waitForResponse(r => r.url().includes('/rest/v1/matches') && ['POST', 'PATCH'].includes(r.request().method()) && JSON.parse(r.request().postData() || '{}').resume_state?.paused === true);
  await clickLabel('Pause match');
  await pausedSaved;
  await player.waitForSelector('[aria-label="Resume match"]');
  await player.waitForSelector('::-p-text(Score synced to your account)');
  assert.equal(backend.matches.size, 1, 'One live match is persisted');
  assert.deepEqual([...backend.matches.values()][0].resume_state.scores, [1, 0]);
  assert.equal([...backend.matches.values()][0].resume_state.paused, true);
  for (const [name, width, height] of viewports) {
    await player.setViewport({ width, height });
    await player.evaluate(() => {
      for (const element of document.querySelectorAll('.beta-app div')) {
        if (element.checkVisibility() && ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)) element.scrollTop = 0;
      }
    });
    const bounds = await player.evaluate(() => {
      const shell = document.querySelector('.beta-shell').getBoundingClientRect();
      const tab = document.querySelector('[aria-label="Play tab"]').getBoundingClientRect();
      return { left: shell.left, right: shell.right, tabBottom: tab.bottom, tabRight: tab.right, height: innerHeight, viewport: innerWidth };
    });
    assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.tabRight <= width + 1 && bounds.tabBottom <= height + 1, `${name}: scoring and navigation fit the viewport`);
    await player.screenshot({ path: `${artifacts}/peakle-beta-live-${name}.png` });
  }
  await player.setViewport(flowViewport);
  console.log('Live scoring layout passed at all phone, tablet, and desktop viewports');
  await player.reload({ waitUntil: 'networkidle2' });
  await player.locator('[aria-label="Resume saved match"]').click();
  await player.waitForSelector('[aria-label="Team 1 score 1"]');
  await player.waitForSelector('[aria-label="Resume match"]');
  await clickLabel('Resume match');
  await clickLabel('Undo last point');
  await player.waitForSelector('[aria-label="Team 1 score 0"]');
  await clickLabel('Beta Test Player won the rally');
  await player.waitForSelector('[aria-label="Team 1 score 1"]');
  await player.locator('[aria-label="Cancel match"]').click();
  backend.controls.failMatchWrites = true;
  await clickText('End as final');
  await player.waitForSelector('[aria-label="Retry recording match"]');
  await player.reload({ waitUntil: 'networkidle2' });
  await player.waitForSelector('[aria-label="Retry saving result"]');
  backend.controls.failMatchWrites = false;
  await clickLabel('Retry saving result');
  await player.waitForSelector('::-p-text(Match recorded)');
  assert.equal(backend.matches.size, 1, 'Finishing updates the recovered match instead of duplicating it');
  const finished = [...backend.matches.values()][0];
  assert.equal(finished.status, 'completed');
  assert.equal(finished.match_games.length, 1);
  assert.equal(finished.match_participants.length, 2);
  assert.equal(await player.evaluate(() => localStorage.getItem('@peakle/unfinished-match/11111111-1111-4111-8111-111111111111')), null);
  await player.screenshot({ path: `${artifacts}/peakle-beta-match-result.png` });
  console.log('Match setup, scoring, refresh recovery, undo, and finish passed');
  console.log('Failed result upload recovers after refresh');
  await go('/profile');
  await player.locator('[aria-label^="Edit profile."]').click();
  await player.locator('[aria-label="Display name"]').fill('Beta Updated Player');
  const profileSaved = player.waitForResponse(r => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH');
  await clickLabel('Save profile changes');
  await profileSaved;
  await player.reload({ waitUntil: 'networkidle2' });
  await player.waitForSelector('::-p-text(Beta Updated Player)');
  console.log('Profile changes survive refresh');
  await go(`/activities/competition/${competitionId}`);
  await player.waitForSelector('::-p-text(View divisions and register)');
  await clickText('View divisions and register');
  await player.waitForSelector('::-p-text(Registered in this division.)');
  assert.ok(player.url().includes('/compete'), 'Event link opens tournament registration');
  assert.ok(!player.url().includes('object%20Object'), 'URLs contain record IDs');
  await go('/players/11111111-1111-4111-8111-111111111111');
  await player.waitForSelector('::-p-text(Beta Updated Player)');
  assert.equal(await player.$('[aria-label="Message player"]'), null);
  console.log('Shared event and player links load their records');
  backend.controls.denyAccountAccess = true;
  await player.reload({ waitUntil: 'networkidle2' });
  await player.waitForSelector('input[placeholder="you@example.com"]');
  assert.equal(await player.$('[aria-label="Play tab"]'), null, 'A revoked session must not retain the cached authenticated workspace');
  await player.waitForFunction(() => !Object.keys(localStorage).some(key => key.endsWith('-auth-token') && localStorage.getItem(key)?.includes('fixture-refresh-token')));
  console.log('Revoked session clears authentication and returns to sign-in');
  assert.equal(backend.requests.filter((request) => ['list_direct_conversations', 'send_direct_message', 'start_direct_conversation'].includes(request.resource)).length, 0, 'Private messaging is excluded');
  assert.deepEqual(errors, [], 'No browser exceptions');
  assert.deepEqual([...new Set(compatibilityWarnings)], [], 'No native notification, animation driver, missing-node, or hidden-focus warnings on web');
  console.log('Player beta browser checks passed. All external requests intercepted. Screenshots:', artifacts);
} catch (error) {
  if (player && !player.isClosed()) { console.error('Page at failure:', await player.evaluate(() => document.body.innerText)); await player.screenshot({ path: `${artifacts}/peakle-beta-failure.png` }); }
  throw error;
} finally { await browser.close(); }

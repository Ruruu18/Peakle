import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { installBackend, signInFixture, userId } from './player-web-fixtures.mjs';
const baseUrl = process.env.PLAYER_WEB_URL || 'http://localhost:8081';
const players = [
  { id: '22222222-2222-4222-8222-222222222222', display_name: 'Alex Player', home_area: 'Manila', skill_rating: 3.2 },
  { id: '33333333-3333-4333-8333-333333333333', display_name: 'Sam Player', home_area: 'Makati', skill_rating: 3.4 },
];
const conversations = new Map();
const messages = [];
const writes = [];
const artifacts = join(tmpdir(), 'peakle-profile-message-qa');
mkdirSync(artifacts, { recursive: true });
const browser = await puppeteer.launch({ headless: true });
let page;
try {
  page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // All API requests are fixtures; no real accounts or messages are changed.
  await installBackend(page, baseUrl, async ({ request, url, resource, body, reply: sendReply }) => {
    const reply = async data => { await sendReply(request, data); return true; };
    const player = players.find(player => player.id === body.p_player_id);
    if (resource === 'player_follows') return reply(players.map(player => ({ follower_id: player.id, followed_id: player.id, created_at: new Date().toISOString() })));
    if (resource === 'profiles' && url.searchParams.get('id')?.startsWith('in.')) return reply(players);
    if (resource === 'get_public_player_profile' && player) return reply([player]);
    if (resource === 'get_player_follow_counts') return reply({ followers: 2, following: 2 });
    if (resource === 'get_direct_message_permission') return reply({ is_following: true, follows_you: true, can_message: true, peer_chat_eligible: true });
    if (resource === 'find_direct_conversation') return reply([...conversations.values()].filter(conversation => conversation.peer_id === body.p_player_id));
    if (resource === 'get_direct_conversation') return reply([conversations.get(body.p_conversation_id)].filter(Boolean));
    if (resource === 'list_direct_conversations') return reply([...conversations.values()]);
    if (resource === 'direct_messages') return reply(messages.filter(message => url.searchParams.get('conversation_id') === `eq.${message.conversation_id}`));
    if (resource === 'start_direct_conversation') {
      writes.push(body);
      const id = `conversation-${conversations.size + 1}`;
      conversations.set(id, { conversation_id: id, peer_id: player.id, peer_name: player.display_name, peer_home_area: player.home_area, status: 'accepted', requester_id: userId });
      const message = { id: `message-${messages.length + 1}`, conversation_id: id, sender_id: userId, body: body.p_body, created_at: new Date().toISOString() };
      messages.push(message);
      return reply({ conversation_id: id, message_id: message.id, conversation_status: 'accepted' });
    }
    return false;
  });
  await page.setViewport({ width: 1440, height: 1000 });
  await signInFixture(page, baseUrl);
  const scene = '[data-browser-scene]:not([inert])';
  const clickLabel = label => page.locator(`${scene} [aria-label="${label}"]`).click();
  await page.locator('[aria-label="Profile tab"]').click();
  await clickLabel('Following 2 players. Open following list');
  await clickLabel("Open Alex Player's profile");
  await page.waitForSelector(`${scene} [aria-label="Message Alex Player"]`);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    await page.setViewport({ width, height });
    await page.screenshot({ path: `${artifacts}/profile-${name}.png` });
    const visible = await page.$eval(`${scene} [aria-label="Message Alex Player"]`, button => {
      const bounds = button.getBoundingClientRect();
      return button.checkVisibility() && bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth;
    });
    assert.ok(visible, `${name}: Message button visible`);
  }
  await clickLabel('Message Alex Player');
  await page.waitForSelector('textarea[placeholder="Message Alex Player"]');
  assert.match(page.url(), /playerId=22222222/);
  console.log('PASS Following → profile → Message opens Alex conversation on web');
  await page.locator('textarea[placeholder="Message Alex Player"]').fill('Ready for a game, Alex?');
  await clickLabel('Send message');
  await page.waitForFunction(() => document.body.innerText.includes('Ready for a game, Alex?'));
  assert.equal(writes[0].p_player_id, players[0].id);
  console.log('PASS first message creates the correct conversation');
  await clickLabel('Go back');
  await clickLabel('Go back');
  await clickLabel("Open Sam Player's profile");
  await clickLabel('Message Sam Player');
  await page.waitForSelector('textarea[placeholder="Message Sam Player"]');
  assert.equal(await page.$(`${scene} textarea[placeholder="Message Alex Player"]`), null);
  console.log('PASS switching followed players opens Sam conversation');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('textarea[placeholder="Message Sam Player"]');
  await page.locator('textarea[placeholder="Message Sam Player"]').fill('Ready for a game, Sam?');
  await clickLabel('Send message');
  await page.waitForFunction(() => document.body.innerText.includes('Ready for a game, Sam?'));
  assert.equal(writes[1].p_player_id, players[1].id);
  assert.equal(conversations.size, 2);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('textarea[placeholder="Message Sam Player"]');
  await page.waitForFunction(() => document.body.innerText.includes('Ready for a game, Sam?'));
  assert.ok(!(await page.$eval(scene, element => element.innerText)).includes('Ready for a game, Alex?'));
  console.log('PASS second recipient, saved conversation, and refresh keep their own messages');
  assert.deepEqual(errors, []);
  console.log('PASS refreshed chat link and no browser exceptions');
} catch (error) {
  if (page) {
    console.error(await page.evaluate(() => document.querySelector('[data-browser-scene]:not([inert])')?.innerText || document.body.innerText));
    await page.screenshot({ path: `${artifacts}/failure.png` });
  }
  throw error;
} finally {
  await browser.close();
}

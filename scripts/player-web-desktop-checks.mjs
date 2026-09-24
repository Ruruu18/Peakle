import assert from 'node:assert/strict';

// Called by player-web-qa --desktop-flows. Uses only the intercepted fixture API.
export async function checkDesktopLayouts(page, backend, baseUrl, artifacts) {
  const go = async (path) => {
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-player-navigation="sidebar"]');
  };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const checkGrid = async (name, columns) => {
    const selector = `[data-browser-scene]:not([inert]) [data-desktop-layout="${name}"]`;
    await page.waitForSelector(selector);
    const result = await page.$eval(selector, element => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      children: [...element.children].map(child => {
        const rect = child.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, width: rect.width };
      }),
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    }));
    assert.equal(result.columns, columns, `${name}: ${columns} columns`);
    assert.ok(result.children.every(child => child.left >= result.left - 1 && child.right <= result.right + 1), `${name}: columns stay inside the content`);
    if (result.children.length > 1) assert.ok(result.children[1].left > result.children[0].left, `${name}: content actually appears side by side`);
  };
  const checkDialog = async (name) => {
    // RN assigns role=dialog after onShow, when Escape/focus handling is active.
    await page.waitForSelector('[role="dialog"][aria-modal="true"]');
    for (const [width, height] of [[1024, 600], [1440, 1000]]) {
      await page.setViewport({ width, height });
      await page.waitForFunction(() => {
        const surface = [...document.querySelectorAll('[data-web-dialog="surface"]')].find(element => element.checkVisibility());
        if (!surface) return false;
        const rect = surface.getBoundingClientRect();
        return Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 2;
      });
      const bounds = await page.evaluate(() => {
        const element = [...document.querySelectorAll('[data-web-dialog="surface"]')].find(element => element.checkVisibility());
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, overflow: element.scrollWidth - element.clientWidth };
      });
      assert.ok(bounds.left >= 24 && bounds.right <= width - 24 && bounds.top >= 24 && bounds.bottom <= height - 24, `${name}: dialog fits a ${width}×${height} viewport`);
      assert.ok(bounds.width <= 641 && bounds.overflow <= 1, `${name}: bounded dialog without clipped content`);
      await page.screenshot({ path: `${artifacts}/desktop-dialog-${name}-${width}.png` });
    }
  };
  backend.controls.layoutFixtures = true;
  for (const width of [1024, 1440]) {
    await page.setViewport({ width, height: 900 });
    await go('/');
    await checkGrid('home', 2);
    await go('/profile');
    await checkGrid('profile', 2);
    await go('/leaderboard');
    await checkGrid('leaderboard', 2);
    await go('/explore');
    await page.waitForSelector('::-p-text(Community Courts 6)');
    await checkGrid('court-grid', width >= 1440 ? 3 : 2);
    await page.screenshot({ path: `${artifacts}/desktop-courts-${width}.png` });
    // Resize through the breakpoint with an active search; no navigation remount.
    await page.locator('input[placeholder="Court or neighborhood"]').fill('Courts 6');
    await page.setViewport({ width: 390, height: 844 });
    await page.waitForSelector('[data-player-navigation="bottom"]');
    assert.equal(await page.$eval('input[placeholder="Court or neighborhood"]', element => element.value), 'Courts 6');
    await page.setViewport({ width, height: 900 });
    await page.waitForSelector('[data-player-navigation="sidebar"]');
    await settle();
    assert.equal(await page.$eval('input[placeholder="Court or neighborhood"]', element => element.value), 'Courts 6');
  }
  await go('/');
  await page.locator('[aria-label^="Open notifications"]').click();
  await checkDialog('notifications');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[aria-modal="true"]', { hidden: true });
  await page.locator('[aria-label="Change search location"]').click();
  await checkDialog('location');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[aria-modal="true"]', { hidden: true });
  await go('/profile');
  await page.locator('[aria-label^="Edit profile."]').click();
  await checkDialog('edit-profile');
  await page.locator('[aria-label="Display name"]').fill('Unsaved desktop edit');
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  assert.equal(await page.$eval('[aria-label="Display name"]', element => element.value), 'Unsaved desktop edit');
  await page.setViewport({ width: 1440, height: 1000 });
  await settle();
  assert.equal(await page.$eval('[aria-label="Display name"]', element => element.value), 'Unsaved desktop edit');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[aria-modal="true"]', { hidden: true });
  await page.locator('[aria-label^="Change player status."]').click();
  await checkDialog('player-status');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[aria-modal="true"]', { hidden: true });
  await go('/teams');
  await page.locator('[aria-label="Create team"]').click();
  await checkDialog('create-team');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[aria-modal="true"]', { hidden: true });
  await go('/');
  await page.locator('[aria-label="Use dark dashboard"]').click();
  await page.waitForSelector('[aria-label="Use light dashboard"]');
  await page.screenshot({ path: `${artifacts}/desktop-dark-home.png` });
  await page.locator('[aria-label="Use light dashboard"]').click();
  backend.controls.layoutFixtures = false;
  console.log('Desktop grids, populated court cards, dialogs on short screens, theme switching, and state preservation across resizing passed');
}

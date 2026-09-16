import assert from "node:assert/strict";
import puppeteer from "puppeteer";

// Exercise actual clicks in an isolated demo session; no live data is changed.
const baseUrl = process.env.PORTAL_BASE_URL || "http://localhost:3000";
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15000);

async function clickRoute(selector, href) {
  await page.locator(selector).click();
  await page.waitForFunction((href) => location.pathname === href, {}, href);
  await page.waitForFunction(() => !Array.from(document.querySelectorAll(".content .empty-state h3")).some((element) => element.textContent === "Loading"));
  assert.equal(await page.$eval(".content", (element) => element.textContent.includes("Something went wrong")), false, href);
}

async function openMenu() {
  await page.locator('.mobile-bottom-nav button[aria-controls="mobile-more-menu"]').click();
  await page.waitForFunction(() => document.querySelector("#mobile-more-menu")?.matches(":modal"));
  assert.equal(await page.$eval("body", (element) => element.style.overflow), "hidden");
}

async function menuIsClosed() {
  await page.waitForSelector("#mobile-more-menu", { hidden: true });
  await page.waitForFunction(() => document.body.style.overflow !== "hidden");
  assert.equal(await page.$eval('.mobile-bottom-nav button[aria-controls="mobile-more-menu"]', (element) => element.getAttribute("aria-expanded")), "false");
}

try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => {
    sessionStorage.setItem("peakle-organizer-demo", "1");
    localStorage.setItem("peakle-organizer-theme", "light");
  });
  await page.goto(`${baseUrl}/overview`, { waitUntil: "networkidle2" });
  await page.waitForSelector(".portal");

  const routes = await page.$$eval(".sidebar .nav-link", (links) => links.map((link) => link.getAttribute("href")));
  for (const href of routes) {
    await clickRoute(`.sidebar .nav-link[href="${href}"]`, href);
    assert.equal(await page.$eval(".sidebar .nav-link[aria-current=page]", (element) => element.getAttribute("href")), href);
  }
  checks.push(`All ${routes.length} desktop navigation tabs open and select the correct section`);

  await clickRoute(".profile-chip", "/settings/profile");
  await page.waitForSelector("#profile-name");
  assert.equal(await page.$eval(".settings-nav-link[aria-current=page]", (element) => element.textContent.trim()), "Profile");
  const settingsRoutes = await page.$$eval(".settings-nav-link", (links) => links.map((link) => link.getAttribute("href")));
  for (const href of settingsRoutes) {
    await clickRoute(`.settings-nav-link[href="${href}"]`, href);
    assert.equal(await page.$eval(".settings-nav-link[aria-current=page]", (element) => element.getAttribute("href")), href);
  }
  await clickRoute(".notification-button", "/notifications");
  checks.push("Profile opens the profile editor directly; settings tabs and notifications navigate correctly");

  await page.setViewport({ width: 390, height: 844 });
  for (const href of ["/overview", "/open-play", "/monitor", "/players"]) {
    await clickRoute(`.mobile-bottom-nav a[href="${href}"]`, href);
    assert.equal(await page.$eval(".mobile-bottom-nav a[aria-current=page]", (element) => element.getAttribute("href")), href);
  }
  checks.push("All four mobile navigation tabs open and select the correct section");

  await openMenu();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close organizer tools");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  assert.equal(await page.evaluate(() => document.activeElement?.closest(".mobile-more-actions") !== null), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close organizer tools");
  await page.keyboard.press("Escape");
  await menuIsClosed();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-controls")), "mobile-more-menu");
  checks.push("More keeps keyboard focus inside; Escape closes it, restores focus, and unlocks scrolling");

  await openMenu();
  await page.locator('[aria-label="Close organizer tools"]').click();
  await menuIsClosed();
  await openMenu();
  await page.setViewport({ width: 1440, height: 900 });
  await menuIsClosed();
  await page.setViewport({ width: 390, height: 844 });
  await menuIsClosed();
  checks.push("Closing More or switching to desktop releases the menu and page scroll lock");

  for (const href of routes.filter((href) => !["/overview", "/open-play", "/monitor", "/players"].includes(href))) {
    await openMenu();
    await clickRoute(`.mobile-more a[href="${href}"]`, href);
    await menuIsClosed();
    assert.equal(await page.$eval(".mobile-bottom-nav button", (element) => element.classList.contains("active")), true);
  }
  checks.push("Every More menu item navigates and closes the menu");

  await openMenu();
  await page.goBack();
  await page.waitForFunction(() => location.pathname === "/support");
  await menuIsClosed();
  await page.goForward();
  await page.waitForFunction(() => location.pathname === "/settings");
  await menuIsClosed();
  checks.push("Browser Back and Forward close More without leaving an invisible scroll lock");

  await clickRoute(".profile-chip", "/settings/profile");
  await page.waitForSelector("#profile-name");
  assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0);
  await page.screenshot({ path: "/private/tmp/peakle-navigation-profile-mobile.png", fullPage: true });
  await openMenu();
  await page.screenshot({ path: "/private/tmp/peakle-navigation-menu-mobile.png", fullPage: true });
  await page.keyboard.press("Escape");
  await menuIsClosed();
  checks.push("Mobile profile opens directly and fits the viewport");

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: "/private/tmp/peakle-navigation-qa-failure.png", fullPage: true });
  console.log(JSON.stringify({ checks, errors, url: page.url() }, null, 2));
  throw error;
} finally {
  await browser.close();
}

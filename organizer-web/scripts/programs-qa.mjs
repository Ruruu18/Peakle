import assert from "node:assert/strict";
import puppeteer from "puppeteer";

// Uses the isolated demo workspace; no Supabase records are changed.
const baseUrl = process.env.PORTAL_BASE_URL || "http://localhost:3000";
const browser = await puppeteer.launch({ headless: true });
const errors = [];
const checks = [];
const page = await browser.newPage();
try {
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => { sessionStorage.setItem("peakle-organizer-demo", "1"); localStorage.setItem("peakle-organizer-theme", "light"); });
  const open = async (path) => { await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle2" }); await page.waitForSelector(".program-workspace"); };
  const clickText = async (text, selector = "button") => {
    const handle = await page.waitForFunction((text, selector) => Array.from(document.querySelectorAll(selector)).find((element) => element.textContent.trim() === text), {}, text, selector);
    await handle.asElement().click(); await handle.dispose();
  };
  const fill = async (selector, value) => {
    await page.$eval(selector, (element, value) => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  };
  const metric = async (index, expected) => page.waitForFunction((index, expected) => document.querySelectorAll(".metric-value")[index]?.textContent === expected, {}, index, expected);
  const confirm = async (label) => { await clickText(label, ".program-dialog button"); await page.waitForSelector(".program-dialog", { hidden: true }); };
  const layout = async (name) => {
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
    assert.equal(overflow, 0, `${name}: horizontal overflow`);
    await page.screenshot({ path: `/private/tmp/peakle-programs-${name}.png`, fullPage: true });
    checks.push(`${name}: no horizontal overflow`);
  };

  await open("/programs");
  assert.equal(await page.$$eval(".program-card", (cards) => cards.length), 4);
  await layout("desktop-list");
  await fill('[aria-label="Search programs"]', "advanced");
  await page.waitForFunction(() => document.querySelectorAll(".program-card").length === 1);
  await page.click('a[href="/programs/demo-program-2"]');
  await page.waitForSelector(".program-management-header");
  await metric(0, "6/8"); await metric(1, "2");
  await layout("desktop-manage");

  await clickText("Admit player"); await metric(0, "7/8"); await metric(1, "1");
  await clickText("Admit player"); await metric(0, "8/8"); await metric(1, "0");
  await page.click('[aria-label="Cancel registration for Alex Reyes"]');
  await confirm("Cancel registration"); await metric(0, "7/8");
  checks.push("Waitlist admissions and cancellations update capacity and preserve history");

  await clickText("Close registration"); await confirm("Close registration");
  await page.waitForSelector(".program-management-header .status.closed");
  await clickText("Open registration"); await confirm("Open registration");
  await page.waitForSelector(".program-management-header .status.open");
  checks.push("Registration closes and reopens");

  await clickText("Edit program");
  await fill("#program-capacity", "6");
  assert.equal(await page.$eval("#program-capacity", (input) => input.validity.rangeUnderflow), true);
  await fill("#program-capacity", "9");
  await fill("#program-name", "Advanced Coaching Intensive");
  await fill("#program-description", "Updated training plan for experienced players.");
  const startValue = await page.$eval("#program-start", (input) => input.value);
  const endValue = await page.$eval("#program-end", (input) => input.value);
  await fill("#program-end", startValue);
  await clickText("Save changes"); await page.waitForSelector(".program-inline-error");
  await fill("#program-end", endValue);
  await clickText("Save changes"); await page.waitForSelector(".program-dialog", { hidden: true });
  await metric(0, "7/9");
  assert.equal(await page.$eval(".program-heading-copy h1", (element) => element.textContent), "Advanced Coaching Intensive");
  checks.push("Editing persists details and rejects invalid capacity and date order");

  await fill('[aria-label="Search participants"]', "missing player");
  await page.waitForFunction(() => document.body.textContent.includes("No matching participants"));
  await clickText("Clear filters");
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: "/private/tmp", eventsEnabled: true });
  const downloaded = new Promise((resolve) => cdp.once("Browser.downloadWillBegin", resolve));
  await clickText("Export roster");
  const download = await downloaded;
  assert.match(download.suggestedFilename, /advanced-coaching-intensive-roster.csv/);
  checks.push("Participant search and roster export work");

  await clickText("Cancel program"); await confirm("Cancel program");
  await page.waitForSelector(".program-management-header .status.cancelled");
  assert.equal(await page.$$eval(".program-participant-actions button", (buttons) => buttons.length), 0);
  await page.click(".page-head-back");
  await clickText("Cancelled", ".program-list-toolbar button");
  await page.waitForFunction(() => document.querySelectorAll(".program-card").length === 1);
  checks.push("Cancelled programs retain history and appear in the cancelled filter");

  await open("/programs/demo-program-live");
  await metric(2, "2");
  await clickText("Mark attended"); await metric(2, "3");
  await clickText("Undo attendance"); await metric(2, "2");
  await clickText("No show"); await metric(0, "7/12");
  checks.push("Attendance, no-shows, and attendance corrections update the roster");

  await page.setViewport({ width: 390, height: 844 });
  await layout("mobile-manage");
  await clickText("Edit program"); await page.waitForSelector("#program-name");
  await layout("mobile-edit");
  await page.keyboard.press("Escape"); await page.waitForSelector(".program-dialog", { hidden: true });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.click('[aria-label="Use dark mode"]');
  await page.setViewport({ width: 390, height: 844 });
  await layout("mobile-dark");
  await page.setViewport({ width: 1440, height: 1000 });
  await page.click('[aria-label="Use light mode"]');

  await open("/programs");
  await clickText("Create", ".page-actions button");
  await fill("#create-name", "Community Skills Clinic");
  await clickText("Continue", ".dialog-actions button");
  await page.click('[aria-label="Next month"]');
  const nextMonthDay = await page.$(".calendar-grid button:not(.muted):not([disabled])");
  await nextMonthDay.click();
  await page.waitForFunction(() => !document.querySelector(".schedule-trigger strong")?.textContent.includes("Choose"));
  await clickText("Continue", ".dialog-actions button");
  await page.waitForSelector("#create-program-duration");
  assert.equal(await page.$eval("#create-capacity", (input) => input.max), "200");
  await fill("#create-program-duration", "3");
  await fill("#create-program-description", "Friendly drills and practice games.");
  await clickText("Publish program", ".dialog-actions button");
  await page.waitForSelector(".dialog-activity", { hidden: true });
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".program-card h3")).some((title) => title.textContent === "Community Skills Clinic"));
  checks.push("Program creation publishes a configurable duration and description");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: "/private/tmp/peakle-programs-qa-failure.png", fullPage: true });
  console.log(JSON.stringify({ checks, errors, dialog: await page.$eval(".dialog", (element) => element.innerText).catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
}

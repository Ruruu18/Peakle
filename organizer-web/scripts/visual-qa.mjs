import puppeteer from "puppeteer";
import { spawn } from "node:child_process";

const issues = [];
const baseUrl = process.env.PORTAL_BASE_URL || "http://localhost:3000";
const testEmail = process.env.PORTAL_TEST_EMAIL;
const testPassword = process.env.PORTAL_TEST_PASSWORD;
const startServer = process.env.PORTAL_START_SERVER === "1";
const serverPort = new URL(baseUrl).port || "3000";
const server = startServer ? spawn("npm", ["run", "start", "--", "-p", serverPort], { stdio: "inherit" }) : null;

if (server) {
  process.on("exit", () => server.kill());
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok || response.status < 500) break;
    } catch {
      if (attempt === 39) throw new Error(`Portal server did not start at ${baseUrl}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

async function openPortal(page, path) {
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle2", timeout: 30000 });

  if (await page.$(".portal")) return true;
  await page.waitForSelector(".login-page", { timeout: 10000 });
  if (!testEmail || !testPassword) return false;

  await page.type("#email", testEmail);
  await page.type("#password", testPassword);
  await Promise.all([
    page.waitForSelector(".portal", { timeout: 15000 }),
    page.click(".login-submit"),
  ]);
  return true;
}

function layoutAudit() {
  return {
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    hasPreviewAction: Boolean(document.querySelector(".preview-link")),
    hasPortal: Boolean(document.querySelector(".portal")),
    hasLogin: Boolean(document.querySelector(".login-page")),
    hasLoadingScreen: Boolean(document.querySelector(".loading-screen")),
    hasSetupWarning: Boolean(document.querySelector(".notice.warning")),
    signInEnabled: document.querySelector(".login-submit") ? !document.querySelector(".login-submit").disabled : null,
  };
}

const layouts = [];
for (const spec of [
  { width: 1440, height: 960, path: "/overview", name: "desktop" },
  { width: 390, height: 844, path: "/overview", name: "mobile" },
]) {
  const page = await browser.newPage();
  await page.setViewport({ width: spec.width, height: spec.height, deviceScaleFactor: spec.width < 600 ? 2 : 1, isMobile: spec.width < 600 });
  const authenticated = await openPortal(page, spec.path);
  const layout = await page.evaluate(layoutAudit);
  if (layout.horizontalOverflow) issues.push(`${spec.name}: ${layout.horizontalOverflow}px horizontal overflow`);
  if (layout.hasPreviewAction) issues.push(`${spec.name}: fake preview action is still visible`);
  if (layout.hasSetupWarning) issues.push(`${spec.name}: Supabase setup warning is visible`);
  if (layout.hasLoadingScreen) issues.push(`${spec.name}: loading screen did not resolve`);
  if (!authenticated && !layout.hasLogin) issues.push(`${spec.name}: real sign-in screen is missing`);
  layouts.push({ name: spec.name, authenticated, ...layout });
  await page.screenshot({ path: `/private/tmp/peakle-organizer-${spec.name}.png`, fullPage: true });
  await page.close();
}

await browser.close();
server?.kill();
console.log(JSON.stringify({ mode: testEmail && testPassword ? "authenticated" : "sign-in", layouts, issues }, null, 2));
if (issues.length) process.exitCode = 1;

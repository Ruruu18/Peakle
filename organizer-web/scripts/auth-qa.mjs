import assert from 'node:assert/strict';
import { authUser, session, profile } from '../../scripts/player-web-fixtures.mjs';
import puppeteer from 'puppeteer';
// All external requests are intercepted; these credentials are fixtures only.
const base = process.env.PORTAL_BASE_URL || 'http://localhost:3000';
const browser = await puppeteer.launch({headless:true});
try {
 for (const restoreDemo of [false,true]) {
  const context=await browser.createBrowserContext();
  const page=await context.newPage();
  const requests=[];
  await page.setViewport({width:1440,height:1000});
  await page.setRequestInterception(true);
  page.on('request',req=>{
   const url=new URL(req.url());
   if(url.origin===base||['data:','blob:'].includes(url.protocol)) return void req.continue();
   requests.push(url.pathname);
   const resource=url.pathname.split('/').at(-1);
   let data=[];
   if(resource==='token')data=session;
   if(resource==='user')data=authUser;
   if(resource==='profiles')data=[profile];
   return void req.respond({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
  });
  if(restoreDemo)await page.evaluateOnNewDocument(()=>sessionStorage.setItem('peakle-organizer-demo','1'));
  await page.goto(base+(restoreDemo?'/overview':'/login'),{waitUntil:'networkidle2'});
  if(restoreDemo){await page.waitForSelector('.demo-mode-banner button');await page.click('.demo-mode-banner button');}
  await page.waitForSelector('#email');
  await page.locator('#email').fill('beta-test@example.invalid');
  await page.locator('#password').fill('fixture-password');
  await page.click('.login-submit');
  try {await page.waitForFunction(()=>document.querySelector('.portal')&&!document.querySelector('.demo-mode-banner'),{timeout:12000});}
  catch {console.error(JSON.stringify({restoreDemo,tokenRequested:requests.includes('/auth/v1/token'),loginStillVisible:Boolean(await page.$('.login-page')),pageText:(await page.evaluate(()=>document.body.innerText)).slice(0,800)}));throw new Error('Organizer auth handoff failed');}
  assert.ok(requests.includes('/auth/v1/token'));
  console.log('PASS organizer password sign-in, restored demo:',restoreDemo);
  await context.close();
 }
} finally {await browser.close();}

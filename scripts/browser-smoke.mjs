// Isolated Chromium smoke test; native permission prompts and the side-panel shell need manual QA.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const work = resolve('.browser-test');
const extension = resolve(work, 'extension');
const profile = resolve(work, `profile-${Date.now()}`);
mkdirSync(profile, { recursive: true });
cpSync(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
writeFileSync(resolve(extension, 'manifest.json'), JSON.stringify(manifest));

const server = createServer((req, res) => {
  const isCss = req.url?.endsWith('style.css');
  res.setHeader('Content-Type', isCss ? 'text/css' : 'text/html');
  res.end(readFileSync(resolve('demo', isCss ? 'style.css' : 'index.html')));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const articleUrl = `http://127.0.0.1:${server.address().port}/demo/`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browserExecutable = process.env.RETURNPOINT_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edge = spawn(browserExecutable, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
edge.stderr.on('data', (data) => { stderr += data.toString(); });
edge.on('error', (error) => { stderr += error.message; });
let ws;
let serial = 0;
const waiting = new Map();
const browserErrors = [];
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++serial;
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 15000);
  waiting.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
async function poll(action, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function evaluate(session, expression, userGesture = false) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture }, session);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}
async function attach(targetId) {
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Page.enable', {}, sessionId).catch(() => undefined);
  return sessionId;
}
async function click(session, text) {
  const clicked = await evaluate(session, `(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button || button.disabled) return false; button.click(); return true; })()`, true);
  assert.ok(clicked, `Missing or disabled button: ${text}`);
}
try {
  const portFile = resolve(profile, 'DevToolsActivePort');
  await poll(() => existsSync(portFile), 'Edge debugging port');
  const [port, browserPath] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  ws = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && waiting.has(message.id)) {
      const pending = waiting.get(message.id);
      waiting.delete(message.id);
      clearTimeout(pending.timer);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const worker = await poll(async () => (await cdp('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://') && t.url.endsWith('/background.js')), 'extension worker');
  const extensionId = new URL(worker.url).host;
  const workerSession = await attach(worker.targetId);
  await poll(() => evaluate(workerSession, 'typeof chrome !== "undefined" && !!chrome.storage'), 'worker Chrome API initialization');
  await evaluate(workerSession, 'chrome.storage.local.clear()');
  const article = await cdp('Target.createTarget', { url: articleUrl });
  const articleSession = await attach(article.targetId);
  await poll(() => evaluate(articleSession, 'document.readyState === "complete"'), 'article load');
  await evaluate(articleSession, 'window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * .5)');
  const panel = await cdp('Target.createTarget', { url: `chrome-extension://${extensionId}/sidepanel.html`, background: true });
  const panelSession = await attach(panel.targetId);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 340, height: 900, deviceScaleFactor: 1, mobile: false }, panelSession);
  await evaluate(workerSession, `chrome.tabs.query({}).then(tabs => chrome.tabs.update(tabs.find(t => t.url === ${JSON.stringify(articleUrl)}).id, {active: true}))`);
  await poll(() => evaluate(panelSession, '[...document.querySelectorAll("button")].some(b => b.textContent.includes("Save Reading Position") && !b.disabled)'), 'Save availability');
  await click(panelSession, '+ Save Reading Position');
  await poll(() => evaluate(panelSession, '!!document.querySelector("textarea")'), 'save form');
  await evaluate(panelSession, '(() => { const field = document.querySelector("textarea"); field.value = "Continue near chapter five\\n<script>safe text</script>"; field.dispatchEvent(new Event("input", {bubbles: true})); })()');
  await click(panelSession, 'Save ReturnPoint');
  await poll(() => evaluate(panelSession, 'document.querySelectorAll(".entry-card").length === 1'), 'saved entry');
  let library = await evaluate(workerSession, 'chrome.storage.local.get("returnpoint.library.v1").then(s => s["returnpoint.library.v1"].entries)');
  assert.equal(library.length, 1);
  assert.ok(Math.abs(library[0].progress - .5) < .02);
  const libraryScreenshot = await cdp('Page.captureScreenshot', { format: 'png' }, panelSession);
  writeFileSync(resolve(work, 'panel-library.png'), Buffer.from(libraryScreenshot.data, 'base64'));
  await cdp('Target.closeTarget', { targetId: article.targetId });
  await poll(() => evaluate(panelSession, '!![...document.querySelectorAll("button")].find(b => b.textContent === "Resume ↗" && !b.disabled)'), 'Resume button');
  await click(panelSession, 'Resume ↗');
  await poll(() => evaluate(panelSession, '!!document.querySelector(".restoration-status.success")'), 'successful automatic restoration');
  const resumedTarget = (await cdp('Target.getTargets')).targetInfos.find(t => t.type === 'page' && t.url === articleUrl);
  assert.ok(resumedTarget, 'Resume opened a new article tab');
  const resumedSession = await attach(resumedTarget.targetId);
  const ratio = await evaluate(resumedSession, 'scrollY / (document.documentElement.scrollHeight - innerHeight)');
  assert.ok(Math.abs(ratio - .5) < .02, `Restored ratio: ${ratio}`);
  assert.equal(await evaluate(panelSession, 'document.querySelector(".note-body").textContent'), 'Continue near chapter five\n<script>safe text</script>');
  const resumeScreenshot = await cdp('Page.captureScreenshot', { format: 'png' }, panelSession);
  writeFileSync(resolve(work, 'panel-resume.png'), Buffer.from(resumeScreenshot.data, 'base64'));
  await cdp('Target.activateTarget', { targetId: resumedTarget.targetId });
  await evaluate(resumedSession, 'scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * .75)');
  await poll(() => evaluate(panelSession, '[...document.querySelectorAll("button")].some(b => b.textContent === "Update Progress" && !b.disabled)'), 'Update Progress availability');
  await click(panelSession, 'Update Progress');
  await poll(() => evaluate(workerSession, 'chrome.storage.local.get("returnpoint.library.v1").then(s => s["returnpoint.library.v1"].entries[0].progress > .7)'), 'updated progress');
  await click(panelSession, '✓  Mark Completed');
  await poll(() => evaluate(panelSession, 'document.querySelector(".section-tab.selected")?.textContent.includes("Completed")'), 'Completed section');
  await click(panelSession, 'Move to Active');
  await poll(() => evaluate(panelSession, 'document.querySelector(".section-tab.selected")?.textContent.includes("Active")'), 'Active section');
  await click(panelSession, 'Delete');
  await click(panelSession, 'Keep it');
  assert.equal(await evaluate(panelSession, 'document.querySelectorAll(".entry-card").length'), 1);
  await click(panelSession, 'Delete');
  await click(panelSession, 'Delete ReturnPoint');
  await poll(() => evaluate(panelSession, 'document.querySelectorAll(".entry-card").length === 0'), 'confirmed deletion');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' }, panelSession);
  writeFileSync(resolve(work, 'panel-empty.png'), Buffer.from(screenshot.data, 'base64'));
  assert.deepEqual(browserErrors, []);
  console.log(JSON.stringify({ browser: browserExecutable, testOnlyLocalhostGrant: true, nativeSidePanelTested: false,
    passed: ['real UI save', 'safe note rendering', 'close tab', 'one-click resume opens tab', 'actual scroll restoration', 'progress update', 'complete', 'reactivate', 'delete confirmation'], ratio }, null, 2));
} catch (error) {
  console.error(error);
  console.error(stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await cdp('Browser.close').catch(() => undefined); ws.close(); }
  edge.kill();
  server.close();
}

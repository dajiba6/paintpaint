import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { createWall } from '../../server/index.js';

const wall = createWall({ database: ':memory:' });
await new Promise(resolve => wall.http.listen(0, '127.0.0.1', resolve));
const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
let browser;
try {
  browser = await engine.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  for (const mobile of [true, false]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 369, height: 700 } : { width: 1189, height: 670 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    // External fonts are irrelevant to the rendering regression and can stall offline CI.
    await page.route('https://fonts.**/*', route => route.abort());
    await page.goto(`http://127.0.0.1:${wall.http.address().port}`, { waitUntil: 'networkidle' });
    const canvas = page.locator('.konvajs-content canvas');
    assert.equal(await canvas.count(), 3, `initial ${mobile ? 'mobile' : 'desktop'} render must create all three canvas layers: ${errors.join('\n')}`);
    const background = await canvas.nth(0).evaluate(c => [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data]);
    assert.equal(background[3], 255, 'board background must actually be painted');
    await page.getByRole('button', { name: '文字 (T)', exact: true }).click();
    if (mobile) await page.touchscreen.tap(160, 200);
    else await page.mouse.click(160, 200);
    await page.getByRole('textbox', { name: '文字内容' }).fill('手机文字\n测试');
    await page.getByRole('button', { name: '放到画布' }).click();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    assert.equal(await canvas.count(), 3, 'text preview and commit must keep the drawing layers mounted');
    await page.waitForFunction(() => {
      const c = document.querySelectorAll('.konvajs-content canvas')[1];
      return c && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
    }, null, { timeout: 5000 });
    assert.deepEqual(errors.filter(e => !e.includes('Failed to load resource')), []);
    console.log(`${mobile ? 'Mobile' : 'Desktop'}: initial board, text input and visible ink passed`);
    await context.close();
  }
} finally {
  await browser?.close();
  await wall.close();
}

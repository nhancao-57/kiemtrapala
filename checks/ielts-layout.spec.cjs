const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };

// Serve only repository assets. Never use a live account or submit student results.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'pala.test') return route.abort();
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) return route.abort();
    try { await route.fulfill({ body: await fs.readFile(file), contentType: mime[path.extname(file)] || 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
});

for (const filename of ['ielts-mindset-1-1.html', 'ielts.html']) {
  for (const width of [1440, 1024, 768, 390, 320]) {
    test(`${filename} contains both panes and wraps text at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://pala.test/${filename}`);
      await page.locator('#student-name').fill('Layout verification');
      await page.locator('#start-form button').click();
      await expect(page.locator('#exam-toolbar')).toBeVisible();
      const measure = () => page.evaluate(() => {
        const panel = document.querySelector('.exam-part:not([hidden])');
        const left = panel.querySelector('.reading-pane');
        const right = panel.querySelector('.questions-pane');
        const box = element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }; };
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, left: box(left), right: box(right) };
      });
      await page.screenshot({ path: testInfo.outputPath('initial.png') });
      let bounds = await measure();
      expect(bounds.documentWidth).toBeLessThanOrEqual(width);
      expect(bounds.left.width).toBeGreaterThan(width >= 768 ? width * .45 : width * .9);
      expect(bounds.right.right).toBeLessThanOrEqual(width + 1);
      if (width >= 768) {
        expect(Math.abs(bounds.left.width - bounds.right.width)).toBeLessThanOrEqual(1);
        expect(bounds.left.right).toBeLessThanOrEqual(bounds.right.x);
        const divider = page.locator('.exam-part:not([hidden]) .resizer');
        await divider.focus();
        await page.keyboard.press('ArrowRight');
        bounds = await measure();
        expect(bounds.left.width).toBeGreaterThan(bounds.right.width);
        await page.keyboard.press('Home');
      } else {
        expect(bounds.left.bottom).toBeLessThanOrEqual(bounds.right.y + 1);
      }

      await page.locator('#exam-text-size').selectOption('largest');
      const tabs = page.locator('#exam-parts [role="tab"]');
      for (let i = 0; i < await tabs.count(); i++) {
        await tabs.nth(i).click();
        const writing = page.locator('.exam-part:not([hidden]) textarea');
        if (await writing.count()) {
          const essay = 'First paragraph.\nSecond paragraph.\n' + 'LongUnbrokenWritingResponse'.repeat(40);
          await writing.fill(essay);
          await expect(writing).toHaveValue(essay);
          expect(await writing.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        }
        bounds = await measure();
        expect(bounds.documentWidth, `part ${i + 1} viewport`).toBeLessThanOrEqual(width);
        expect(bounds.left.scrollWidth, `part ${i + 1} passage`).toBeLessThanOrEqual(bounds.left.clientWidth + 1);
        expect(bounds.right.scrollWidth, `part ${i + 1} questions`).toBeLessThanOrEqual(bounds.right.clientWidth + 1);
      }
      await tabs.first().click();
      await page.locator('.exam-part:not([hidden]) .question-card h4').first().evaluate(element => { element.textContent = 'VeryLongUnbrokenQuestion'.repeat(30); });
      const option = page.locator('.exam-part:not([hidden]) .question-card label span').first();
      if (await option.count()) {
        await option.evaluate(element => { element.textContent = 'VeryLongUnbrokenAnswer'.repeat(30); });
        expect(await option.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(40);
      }
      bounds = await measure();
      expect(bounds.right.scrollWidth).toBeLessThanOrEqual(bounds.right.clientWidth + 1);
      await page.screenshot({ path: testInfo.outputPath('wrapping.png') });
    });
  }
}

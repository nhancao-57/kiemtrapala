const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let server, origin;
const root = path.resolve(__dirname, '..');

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end(); return;
    }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

test('every opening has the same hierarchy, Vietnamese centre name and usable logout', async ({ page }, info) => {
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const file of ['kids.html', 'teens.html', 'ielts.html', 'ielts-mindset-1-1.html', 'mindset_final_test.html']) {
      await page.goto(`${origin}/${file}`);
      await expect(page.locator('#start-screen')).toBeVisible();
      await expect(page.locator('#test-center')).toHaveText('Trung tâm Ngoại ngữ Pala');
      await expect(page.locator('#test-title')).not.toBeEmpty();
      await expect(page.locator('.test-opening-instructions')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Đăng xuất', exact: true })).toBeVisible();
      expect(await page.evaluate(() => {
        const title = document.querySelector('#test-title').getBoundingClientRect();
        const centre = document.querySelector('#test-center').getBoundingClientRect();
        const instructions = document.querySelector('.test-opening-instructions').getBoundingClientRect();
        return title.bottom <= centre.top && centre.bottom <= instructions.top && document.documentElement.scrollWidth <= innerWidth;
      })).toBe(true);
      if (file === 'ielts.html') await page.screenshot({ path: info.outputPath(`opening-${colorScheme}.png`) });
    }
  }
});

test('logout during an exam can be cancelled and submits POST when accepted', async ({ page }) => {
  await start(page, 'ielts.html');
  let dialogMessage;
  page.once('dialog', dialog => { dialogMessage = dialog.message(); return dialog.dismiss(); });
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  expect(dialogMessage).toContain('Đăng xuất?');
  await expect(page.locator('#exam-toolbar')).toBeVisible();
  await page.route('**/logout', route => {
    expect(route.request().method()).toBe('POST');
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'Signed out' });
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/logout`);
});

async function start(page, file, size = { width: 1366, height: 768 }) {
  await page.setViewportSize(size);
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(`${origin}/${file}`);
  await page.getByLabel(/Nhập họ và tên/).fill('Layout Test');
  await page.getByRole('button', { name: 'Bắt đầu làm bài', exact: true }).click();
  await expect(page.locator('#exam-toolbar')).toBeVisible();
}

for (const file of ['ielts.html', 'ielts-mindset-1-1.html']) {
  for (const size of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    test(`${file}: content fits ${size.width}x${size.height}, question row sits above parts`, async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await start(page, file, size);
      const boxes = await page.evaluate(() => {
        const rect = selector => { const { x, y, width, height, bottom } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height, bottom }; };
        return { questions: rect('.exam-question-row'), parts: rect('#exam-parts'), content: rect('#questions-container'),
          overflow: document.documentElement.scrollWidth > innerWidth, bodyHeight: document.body.getBoundingClientRect().height };
      });
      expect(boxes.overflow).toBe(false);
      expect(boxes.questions.bottom).toBeLessThanOrEqual(boxes.parts.y + 1);
      expect(boxes.parts.bottom).toBeLessThanOrEqual(size.height + 1);
      expect(boxes.content.height).toBeGreaterThan(size.width >= 768 ? size.height * .68 : size.height * .48);
      await expect(page.locator('#btn-submit-test')).toBeVisible();
      if (file.includes('mindset')) await expect(page.locator('#exam-parts button')).toHaveCount(4);
      if (size.width < 768) {
        await expect(page.locator('.exam-part:not([hidden]) .reading-pane')).toBeVisible();
        await expect(page.locator('.exam-part:not([hidden]) .questions-pane')).toBeHidden();
        await page.locator('[data-question-nav="1"]').click();
        await expect(page.locator('.exam-part:not([hidden]) .questions-pane')).toBeVisible();
        await expect(page.locator('.exam-part:not([hidden]) .reading-pane')).toBeHidden();
      }
      await page.screenshot({ path: info.outputPath('workspace.png') });
      expect(errors).toEqual([]);
    });
  }
}

test('group navigation, flags, overview filters, preferences and resumed question work together', async ({ page }) => {
  await start(page, 'ielts-mindset-1-1.html');
  await page.locator('[data-question-nav="8"]').click();
  await expect(page.locator('#active-part-title')).toHaveText('A. LISTENING — PART 2');
  await page.locator('#question-8 input').fill('My answer');
  await page.locator('#review-question').click();
  await expect(page.locator('[data-question-nav="8"]')).toHaveClass(/is-flagged/);
  await page.locator('#exam-tab-3').click();
  await page.locator('#exam-tab-0').click();
  await expect(page.locator('[data-question-nav="8"]')).toHaveAttribute('aria-current', 'true');
  await page.locator('#exam-overview-open').click();
  await expect(page.locator('#exam-overview')).toBeVisible();
  await page.locator('#exam-overview-filter').selectOption('flagged');
  await expect(page.locator('#exam-overview-content button')).toHaveCount(1);
  await page.locator('#exam-overview-filter').selectOption('unanswered');
  await expect(page.locator('#exam-overview-content button')).toHaveCount(60);
  await page.keyboard.press('Escape');
  await expect(page.locator('#exam-overview-open')).toBeFocused();
  await page.locator('#exam-settings-open').click();
  await page.locator('#exam-text-size').selectOption('large');
  await page.getByRole('button', { name: 'Xong', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Tiếp tục làm bài', exact: true }).click();
  await expect(page.locator('[data-question-nav="8"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#question-8 input')).toHaveValue('My answer');
  await expect(page.locator('#test-screen')).toHaveAttribute('data-text-size', 'large');
  await page.locator('#exam-tab-0').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#exam-tab-3')).toBeFocused();
  await expect(page.locator('#active-part-title')).toHaveText('D. WRITING — TASK 1');
  await page.locator('#question-61 textarea').fill('One two\nThree');
  await expect(page.locator('.word-count')).toHaveText('Số từ: 3');
});

test('modal traps focus; submit keeps its original confirmation and can be cancelled', async ({ page }) => {
  await start(page, 'ielts.html');
  await page.locator('#exam-settings-open').click();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.closest('dialog')?.id)).toBe('exam-settings');
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#exam-settings-open')).toBeFocused();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#btn-submit-test').click();
  await expect(page.locator('#test-screen')).toBeVisible();
});

test('resizing persists across parts and reload, and the submit button survives a retake', async ({ page }) => {
  await start(page, 'ielts.html');
  const separator = page.locator('.exam-part:not([hidden]) .resizer');
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await page.locator('#exam-tab-1').click();
  await expect(separator).toHaveAttribute('aria-valuenow', '55');
  await page.reload();
  await page.getByRole('button', { name: 'Tiếp tục làm bài', exact: true }).click();
  await expect(separator).toHaveAttribute('aria-valuenow', '55');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#btn-submit-test').click();
  await expect(page.locator('#result-screen')).toBeVisible();
  await page.locator('#btn-retake').click();
  await page.getByLabel(/Nhập họ và tên/).fill('Second attempt');
  await page.getByRole('button', { name: 'Bắt đầu làm bài', exact: true }).click();
  await expect(page.locator('#exam-toolbar #btn-submit-test')).toBeVisible();
  await expect(page.locator('#exam-toolbar')).toHaveCount(1);
  await expect(page.locator('#exam-settings')).toHaveCount(1);
});

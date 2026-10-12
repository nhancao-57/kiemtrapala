const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const pages = ['kids.html', 'teens.html', 'ielts.html', 'ielts-mindset-1-1.html', 'mindset_final_test.html'];
const tick = () => new Promise(resolve => setImmediate(resolve));

async function openPage(filename, settings = {}) {
  const html = fs.readFileSync(path.join(root, filename), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => {
    if (!/navigation|reload/i.test(error.message)) errors.push(error);
  });
  const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''), {
    url: `https://test.local/${filename}`, runScripts: 'dangerously', virtualConsole: console,
    pretendToBeVisual: true
  });
  const { window } = dom;
  await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve));
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLMediaElement.prototype.pause = function () { this.dataset.pausedByTest = 'true'; };
  window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  window.confirm = () => true;
  window.alert = () => {};
  window.console.error = () => {};
  const submissions = [];
  let failSubmission = settings.failSubmission;
  if (!settings.noSDK) window.supabase = { createClient: () => ({ from: () => ({ insert: payload => ({ abortSignal: async () => {
    submissions.push(JSON.parse(JSON.stringify(payload[0])));
    return { error: failSubmission ? new Error('Offline') : null };
  } }) }) }) };
  window.fetch = async url => ({ ok: !settings.fetchError, json: async () => JSON.parse(fs.readFileSync(path.join(root, url), 'utf8')) });
  const key = html.match(/const STORAGE_KEY = '([^']+)'/)[1];
  if (settings.saved !== undefined) window.localStorage.setItem(key, typeof settings.saved === 'string' ? settings.saved : JSON.stringify(settings.saved));
  if (settings.blockStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
  const run = code => vm.runInContext(code, dom.getInternalVMContext());
  for (const [, attrs, body] of scripts) {
    const src = attrs.match(/src="(\/js\/[^\"]+)"/);
    if (src) run(fs.readFileSync(path.join(root, src[1]), 'utf8'));
    else if (!attrs.includes('src=')) run(body);
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await tick();
  const $ = selector => window.document.querySelector(selector);
  return {
    dom, window, $, key, errors, submissions, run,
    recoverNetwork: () => { failSubmission = false; },
    state: () => JSON.parse(run('JSON.stringify(state)')),
    start(name = 'Test Student') {
      $('#student-name').value = name;
      $('#start-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    }
  };
}

for (const page of pages) {
  test(`${page}: load, validate name, return, submit, restore results`, async t => {
    const app = await openPage(page);
    t.after(() => app.dom.window.close());
    assert.equal(app.window.document.body.dataset.testScreen, 'start');
    assert.equal(app.$('#btn-return').getAttribute('href'), '/index.html');
    app.start('   ');
    assert.equal(app.window.document.body.dataset.testScreen, 'start');
    assert.equal(app.state().name, '');
    app.$('#student-name').dispatchEvent(new app.window.Event('input'));
    app.start();
    assert.equal(app.window.document.body.dataset.testScreen, 'test');
    app.window.confirm = () => false;
    const exit = new app.window.MouseEvent('click', { bubbles: true, cancelable: true });
    app.$('#btn-return').dispatchEvent(exit);
    assert.equal(exit.defaultPrevented, true);
    assert.equal(JSON.parse(app.window.localStorage.getItem(app.key)).name, 'Test Student');
    app.window.confirm = () => true;
    app.$('#btn-submit-test').click();
    app.$('#btn-submit-test').click();
    await tick();
    assert.equal(app.window.document.body.dataset.testScreen, 'result');
    assert.equal(app.submissions.length, 1, 'double clicks cannot duplicate a submission');
    assert.equal(app.state().submissionStatus, 'saved');
    const restored = await openPage(page, { saved: app.state() });
    t.after(() => restored.dom.window.close());
    assert.equal(restored.window.document.body.dataset.testScreen, 'result');
    assert.equal(restored.submissions.length, 0, 'reopening results does not submit again');
    assert.deepEqual(app.errors, []);
    assert.deepEqual(restored.errors, []);
    if (page !== 'mindset_final_test.html') {
      app.$('#btn-retake').click();
      assert.equal(app.window.document.body.dataset.testScreen, 'start');
      assert.equal(app.$('#start-form').classList.contains('hidden'), false);
      app.start('Second Student');
      assert.equal(app.$('#btn-submit-test').disabled, false);
      app.$('#btn-submit-test').click();
      await tick();
      assert.equal(app.submissions.length, 2, 'a retake can submit normally');
    }
  });

  test(`${page}: corrupt storage and missing SDK do not block taking the test`, async t => {
    const app = await openPage(page, { saved: '{broken', noSDK: true });
    t.after(() => app.dom.window.close());
    assert.equal(app.window.document.body.dataset.testScreen, 'start');
    assert.ok(app.$('#save-notice'));
    app.start();
    app.$('#btn-submit-test').click();
    await tick();
    assert.equal(app.window.document.body.dataset.testScreen, 'result');
    assert.equal(app.state().submissionStatus, 'failed');
    assert.deepEqual(app.errors, []);
  });

  test(`${page}: blocked storage, recoverable submission, and retry`, async t => {
    const app = await openPage(page, { blockStorage: true, failSubmission: true });
    t.after(() => app.dom.window.close());
    app.start();
    assert.equal(app.window.document.body.dataset.testScreen, 'test');
    assert.ok(app.$('#save-notice'));
    app.$('#btn-submit-test').click();
    await tick();
    assert.equal(app.state().submissionStatus, 'failed');
    app.recoverNetwork();
    const retry = app.$('#btn-retry-submit') || app.$('#submission-panel button');
    assert.equal(retry.disabled, false);
    retry.click();
    await tick();
    assert.equal(app.state().submissionStatus, 'saved');
    assert.equal(app.submissions.length, 2);
    assert.deepEqual(app.errors, []);
  });

  test(`${page}: an unfinished attempt is not accidentally replaced`, async t => {
    const saved = { name: 'Existing Student', answers: {}, audioPlays: {}, isCompleted: false };
    const app = await openPage(page, { saved });
    t.after(() => app.dom.window.close());
    assert.equal(app.$('#start-form').classList.contains('hidden'), true);
    app.window.confirm = () => false;
    app.$('#btn-restart-clear').click();
    assert.equal(app.state().name, 'Existing Student');
    app.$('#btn-resume').click();
    assert.equal(app.window.document.body.dataset.testScreen, 'test');
    assert.equal(app.state().name, 'Existing Student');
    assert.deepEqual(app.errors, []);
  });
}

for (const page of ['ielts.html', 'ielts-mindset-1-1.html']) {
  test(`${page}: part navigation, answer status, flags, resize and safe answer restoration`, async t => {
    const app = await openPage(page);
    t.after(() => app.dom.window.close());
    app.start();
    const parts = app.window.document.querySelectorAll('.exam-part');
    assert.ok(parts.length > 1);
    assert.equal([...parts].filter(part => !part.hidden).length, 1);
    app.$('#next-part').click();
    assert.equal(app.state().activePart, 1);
    assert.equal(parts[0].hidden, true);
    assert.equal(parts[1].hidden, false);
    app.$('#review-question').click();
    assert.equal(app.$('#review-question').getAttribute('aria-pressed'), 'true');
    assert.ok(app.$('#exam-questions .is-flagged'));
    app.$('#exam-text-size').value = 'largest';
    app.$('#exam-text-size').dispatchEvent(new app.window.Event('change'));
    assert.equal(app.state().textSize, 'largest');
    const text = app.$('#questions-container input[type="text"]');
    assert.ok(text);
    text.value = '\"><img src=x onerror="alert(1)"> & a "quote"';
    text.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    const question = text.closest('[data-question]').dataset.question;
    assert.equal(app.state().answers[question], text.value);
    const restored = await openPage(page, { saved: app.state() });
    t.after(() => restored.dom.window.close());
    restored.$('#btn-resume').click();
    assert.equal(restored.$(`#question-${question} input`).value, text.value);
    assert.equal(restored.$('#questions-container img[src="x"]'), null);
    assert.equal(restored.$('#exam-tab-1').getAttribute('aria-selected'), 'true');
    const divider = restored.$('.resizer');
    divider.dispatchEvent(new restored.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    assert.equal(divider.getAttribute('aria-valuenow'), '55');
    restored.$('#btn-submit-test').click();
    await tick();
    assert.equal(restored.$('#review-container img[src="x"]'), null);
    assert.ok(restored.$('#review-container').textContent.includes(text.value));
    assert.deepEqual(app.errors, []);
    assert.deepEqual(restored.errors, []);
  });
}

test('IELTS writing is saved, counted and excluded from automatic scoring; audio stops on submit', async t => {
  const app = await openPage('ielts-mindset-1-1.html');
  t.after(() => app.dom.window.close());
  app.start();
  const writing = app.$('textarea');
  writing.value = 'A short writing response.';
  writing.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.equal(app.$('.word-count').textContent, 'Số từ: 4');
  app.$('[data-audio-play]').click();
  await tick();
  assert.equal(Object.values(app.state().audioPlays)[0], 1);
  app.$('#btn-submit-test').click();
  await tick();
  assert.equal(app.submissions[0].score_total, 60);
  assert.equal(app.submissions[0].answers['61'], writing.value);
  assert.ok(app.$('#writing-answers').textContent.includes(writing.value));
  assert.equal(app.$('audio').dataset.allowPause, 'true');
  assert.equal(app.$('audio').dataset.pausedByTest, 'true');
  assert.deepEqual(app.errors, []);
});

test('expired timed test resumes straight to results and submits only once', async t => {
  const app = await openPage('mindset_final_test.html', { saved: {
    name: 'Expired Student', answers: {}, audioPlays: {}, isCompleted: false, endTime: Date.now() - 1000
  } });
  t.after(() => app.dom.window.close());
  app.$('#btn-resume').click();
  await tick();
  assert.equal(app.window.document.body.dataset.testScreen, 'result');
  assert.equal(app.submissions.length, 1);
  app.run('updateTimerDisplay()');
  await tick();
  assert.equal(app.submissions.length, 1);
  assert.deepEqual(app.errors, []);
});

test('a data loading error keeps Return and Retry available', async t => {
  const app = await openPage('ielts.html', { fetchError: true });
  t.after(() => app.dom.window.close());
  assert.equal(app.window.document.body.dataset.testScreen, 'error');
  assert.ok(app.$('#btn-return'));
  assert.ok(app.$('#error-screen button'));
});

for (const page of pages) {
  test(`${page}: full correct answers retain the original scoring`, async t => {
    const app = await openPage(page);
    t.after(() => app.dom.window.close());
    app.start();
    if (page === 'mindset_final_test.html') {
      app.run('Object.entries(questionDictionary).forEach(([id, q]) => { state.answers[id] = q.answer; });');
    } else if (page === 'kids.html') {
      app.run('flatQuestions.forEach(q => { state.answers[q.id] = q.correctAnswer; });');
    } else {
      app.run('flatQuestions.filter(q => q.autoGrade !== false).forEach(q => { state.answers[q.number] = q.answer; });');
    }
    app.$('#btn-submit-test').click();
    await tick();
    const payload = app.submissions[0];
    assert.ok(payload.score_total > 0);
    assert.equal(payload.score_correct, payload.score_total);
    assert.equal(Number(app.$('#score-correct').textContent), payload.score_correct);
    assert.equal(Number(app.$('#score-total').textContent), payload.score_total);
    assert.deepEqual(app.errors, []);
  });
}

test('IELTS audio replay rewinds and enforces the existing two-play limit', async t => {
  const app = await openPage('ielts-mindset-1-1.html');
  t.after(() => app.dom.window.close());
  app.start();
  const audio = app.$('audio');
  const button = app.$('[data-audio-play]');
  button.click();
  await tick();
  audio.currentTime = 120;
  audio.dispatchEvent(new app.window.Event('ended'));
  assert.equal(button.disabled, false);
  button.click();
  await tick();
  assert.equal(audio.currentTime, 0);
  assert.equal(Object.values(app.state().audioPlays)[0], 2);
  audio.dispatchEvent(new app.window.Event('ended'));
  assert.equal(button.disabled, true);
  assert.deepEqual(app.errors, []);
});

test('saved data ignores stale question IDs and invalid IELTS answer types', async t => {
  const app = await openPage('ielts.html', { saved: {
    name: 'Student', answers: { '9999': 'old answer', '1': ['invalid array'], '2': 'answer' }, isCompleted: false
  } });
  t.after(() => app.dom.window.close());
  app.$('#btn-resume').click();
  assert.deepEqual(app.state().answers, { '2': 'answer' });
  assert.equal(app.$('#progress-text').textContent, '1');
  assert.deepEqual(app.errors, []);
});

test('timed-test typed answers save on input and render safely in results', async t => {
  const app = await openPage('mindset_final_test.html');
  t.after(() => app.dom.window.close());
  app.start();
  const input = app.$('#questions-container input[type="text"]');
  input.value = '<img src=x onerror="alert(1)">';
  input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.ok(Object.values(app.state().answers).includes(input.value));
  const deadline = app.state().endTime;
  const restored = await openPage('mindset_final_test.html', { saved: app.state() });
  t.after(() => restored.dom.window.close());
  restored.$('#btn-resume').click();
  assert.equal(restored.state().endTime, deadline);
  restored.$('#btn-submit-test').click();
  await tick();
  assert.equal(restored.$('#review-container img[src="x"]'), null);
  assert.ok(restored.$('#review-container').textContent.includes(input.value));
  assert.deepEqual(restored.errors, []);
});

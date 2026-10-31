const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const writingPage = 'ielts-mindset-1-1.html';
const writingKey = 'pala_ielts_mindset_1_1_final_progress';
const settle = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));

async function openPage(file, { storage = {}, upload = () => ({ error: null }), rows = [] } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'), {
    url: `https://pala.test/${file}`, runScripts: 'outside-only'
  });
  const { window } = dom;
  const requests = [];
  const errors = [];
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLMediaElement.prototype.pause = () => {};
  window.console.error = (...args) => errors.push(args);
  window.fetch = async url => ({ ok: true, json: async () =>
    JSON.parse(fs.readFileSync(path.join(root, String(url).replace(/^\//, '')), 'utf8')) });
  Object.entries(storage).forEach(([key, value]) => window.localStorage.setItem(key, value));
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: {} } }), signOut: async () => ({}) },
    from(table) {
      assert.equal(table, 'test_results');
      return {
        insert(payload) {
          return { abortSignal: async signal => {
            assert.ok(signal);
            const request = { payload: clone(payload),
              storage: { ...window.localStorage } };
            requests.push(request);
            return upload(request);
          } };
        },
        select: () => ({ order: async () => ({ data: rows, error: null }) })
      };
    }
  }) };
  const evaluate = code => vm.runInContext(code, dom.getInternalVMContext());
  for (const script of window.document.querySelectorAll('script')) {
    const src = script.getAttribute('src');
    if (src?.startsWith('https:')) continue;
    evaluate(src ? fs.readFileSync(path.join(root, src.replace(/^\//, '')), 'utf8') : script.textContent);
  }
  await settle();
  await settle();
  return { dom, window, requests, errors, evaluate, close: () => window.close() };
}

async function submitWriting(page, answer) {
  page.evaluate(`state.name = 'Học viên Test'; state.answers = ${JSON.stringify({ 1: 'test', 61: answer })};`);
  page.window.document.getElementById('btn-submit-test').click();
  await settle();
}

test('writing upload preserves the full task and multiline Unicode essay, excluding writing from score', async t => {
  const page = await openPage(writingPage);
  t.after(page.close);
  const essay = '  Bananas grow in warm climates.\n\nTiếng Việt & <b>text</b> stays intact.  ';
  await submitWriting(page, essay);
  assert.equal(page.requests.length, 1);
  const request = page.requests[0];
  const payload = request.payload[0];
  assert.equal(payload.score_total, 60);
  assert.equal(payload.answers['61'], essay);
  assert.equal(payload.writing_answers.length, 1);
  const writing = payload.writing_answers[0];
  assert.equal(writing.answer, essay);
  assert.equal(writing.question_id, '61');
  assert.equal(writing.word_count, essay.trim().split(/\s+/u).length);
  assert.match(writing.context, /growing bananas/);
  assert.match(writing.instructions, /teacher marking/);
  assert.equal(writing.image_url, '/tests/IELTS/banana-growing-process.png');
  assert.match(payload.submission_id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(payload.completed_at)));
  const beforeUpload = JSON.parse(request.storage[writingKey]);
  assert.deepEqual(beforeUpload.submissionPayload, payload);
  assert.equal(beforeUpload.submissionStatus, 'pending');
  assert.equal(page.evaluate('state.submissionStatus'), 'saved');
  assert.equal(page.errors.length, 0);
});

test('blank essays are retained as unsubmitted writing, with zero words', async t => {
  const page = await openPage(writingPage);
  t.after(page.close);
  await submitWriting(page, ' \n ');
  assert.equal(page.requests[0].payload[0].writing_answers[0].word_count, 0);
  assert.equal(page.requests[0].payload[0].writing_answers[0].answer, ' \n ');
});

test('unknown upload outcome survives reload and retries the identical attempt without another row', async t => {
  const storedRows = new Map();
  const persist = request => {
    const payload = request.payload[0];
    if (storedRows.has(payload.submission_id)) return { error: {
      code: '23505', message: 'duplicate key value violates unique constraint "test_results_submission_id_key"'
    } };
    storedRows.set(payload.submission_id, payload);
    return { error: null };
  };
  const first = await openPage(writingPage, { upload(request) {
    persist(request); // The server commits, but its response is lost.
    return { error: { message: 'Network response lost' } };
  } });
  t.after(first.close);
  await submitWriting(first, 'Original essay\nSecond paragraph');
  assert.equal(first.evaluate('state.submissionStatus'), 'failed');
  const payload = first.requests[0].payload[0];
  const second = await openPage(writingPage, {
    storage: { ...first.window.localStorage },
    upload: persist
  });
  t.after(second.close);
  assert.equal(second.requests.length, 0);
  // Even if the live test data changes, the already submitted snapshot wins.
  second.evaluate("state.answers[61] = 'Changed'; testData.parts[10].context = 'Changed prompt';");
  second.window.document.getElementById('btn-retry-submit').click();
  await settle();
  assert.deepEqual(second.requests[0].payload[0], payload);
  assert.equal(storedRows.size, 1);
  assert.equal(second.evaluate('state.submissionStatus'), 'saved');
  second.window.document.getElementById('btn-retry-submit').click();
  await settle();
  assert.equal(second.requests.length, 1);
});

test('older pending writing drafts upgrade with a structured writing snapshot', async t => {
  const page = await openPage(writingPage, { storage: { [writingKey]: JSON.stringify({
    name: 'Older draft', answers: { 61: 'Older essay' }, isCompleted: true,
    completionTime: '2026-10-30T03:00:00.000Z', submissionStatus: 'failed'
  }) } });
  t.after(page.close);
  page.window.document.getElementById('btn-retry-submit').click();
  await settle();
  assert.equal(page.requests[0].payload[0].writing_answers[0].answer, 'Older essay');
  assert.equal(page.requests[0].payload[0].completed_at, '2026-10-30T03:00:00.000Z');
});

test('unrelated unique constraints and missing schema never report a successful upload', async t => {
  for (const error of [
    { code: '23505', message: 'duplicate key value violates unique constraint "test_results_pkey"' },
    { code: 'PGRST204', message: 'Could not find the writing_answers column' },
    { code: '42501', message: 'new row violates row-level security policy' }
  ]) {
    const page = await openPage(writingPage, { upload: () => ({ error }) });
    t.after(page.close);
    await submitWriting(page, 'Keep this essay');
    assert.equal(page.evaluate('state.submissionStatus'), 'failed');
    assert.equal(page.window.document.getElementById('btn-retry-submit').disabled, false);
    assert.equal(JSON.parse(page.window.localStorage.getItem(writingKey)).submissionPayload.writing_answers[0].answer,
      'Keep this essay');
  }
});

test('each fresh attempt gets its own ID and writing snapshots support multiple tasks', async t => {
  const page = await openPage(writingPage);
  t.after(page.close);
  const common = page.window.TestCommon;
  const payload = { student_name: 'Test', answers: {} };
  const first = common.prepareSubmission({}, payload);
  const second = common.prepareSubmission({}, payload);
  assert.notEqual(first.submission_id, second.submission_id);
  const tasks = common.collectWritingAnswers({ parts: [{ title: 'Writing', questionSets: [{
    questions: [
      { number: 1, type: 'essay', questionText: 'First task' },
      { number: 2, type: 'long_answer', questionText: 'Second task' },
      { number: 3, type: 'writing', questionText: 'Third task' },
      { number: 4, type: 'multiple_choice', questionText: 'Not writing' }
    ]
  }] }] }, { 1: 'One\ntwo', 2: 'Three' });
  assert.equal(tasks.length, 3);
  assert.deepEqual(clone(tasks.map(task => task.word_count)), [2, 1, 0]);
  assert.equal(tasks[2].answer, '');
});

for (const file of ['kids.html', 'teens.html', 'ielts.html', 'mindset_final_test.html']) {
  test(`${file}: non-writing results keep their score and retry ID`, async t => {
    let shouldFail = true;
    const page = await openPage(file, { upload: () => ({ error: shouldFail ? { message: 'Offline' } : null }) });
    t.after(page.close);
    page.evaluate("state.name = 'Non-writing student';");
    page.window.document.getElementById('btn-submit-test').click();
    await settle();
    assert.equal(page.requests.length, 1);
    const payload = page.requests[0].payload[0];
    assert.deepEqual(payload.writing_answers, []);
    assert.equal(payload.score_correct, 0);
    assert.ok(payload.score_total > 0);
    assert.equal(page.evaluate('state.submissionStatus'), 'failed');
    shouldFail = false;
    page.window.document.querySelector('#submission-panel button').click();
    await settle();
    assert.deepEqual(page.requests[1].payload[0], payload);
    assert.equal(page.evaluate('state.submissionStatus'), 'saved');
  });
}

test('admin displays writing safely and can read legacy essays', async t => {
  const attack = '<img src=x onerror="window.pwned=true">';
  const base = { student_name: attack, test_title: 'IELTS Mindset 1.1 Final Test',
    score_correct: 40, score_total: 60, created_at: '2026-10-31T01:00:00Z' };
  const page = await openPage('admin.html', { rows: [
    { ...base, writing_answers: [{ question_id: '61', section: 'Writing',
      prompt: attack, context: attack, answer: `Paragraph one\n\n${attack}`, image_url: 'javascript:alert(1)' }] },
    { ...base, answers: { 61: 'Legacy essay' } },
    { ...base, test_title: 'Another test', writing_answers: [], answers: { 61: 'Not an essay' } }
  ] });
  t.after(page.close);
  const table = page.window.document.getElementById('results-table-body');
  assert.equal(table.querySelectorAll('details').length, 2);
  assert.match(table.textContent, /Legacy essay/);
  assert.match(table.textContent, /Paragraph one/);
  assert.ok(table.textContent.includes(attack));
  assert.equal(table.querySelectorAll('img').length, 0);
  assert.equal(page.window.pwned, undefined);
  assert.equal(page.errors.length, 0);
});

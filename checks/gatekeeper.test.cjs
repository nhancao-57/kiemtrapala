const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../netlify/edge-functions/gatekeeper.js'), 'utf8');

function setup(overrides = {}) {
  const env = { SITE_USERNAME: 'student', SITE_PASSWORD: 'primary-password', SECONDARY_SITE_PASSWORD: 'secondary-password', ...overrides };
  const sandbox = { Request, Response, URL, TextEncoder, crypto: webcrypto, Netlify: { env: { get: key => env[key] } }, handler: null };
  vm.runInNewContext(source.replace('export default async', 'handler = async'), sandbox);
  const call = (path, init) => sandbox.handler(new Request(`https://pala.test${path}`, init), { next: () => new Response('allowed') });
  const login = password => call('/login', { method: 'POST', body: new URLSearchParams({ username: 'student', password }) });
  return { call, login, sandbox };
}

test('logout expires the site cookie and protected pages cannot be cached', async () => {
  const { call, login } = setup();
  const signedIn = await login('primary-password');
  const cookie = signedIn.headers.get('Set-Cookie').split(';')[0];
  const page = await call('/kids.html', { headers: { cookie } });
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  const response = await call('/logout', { method: 'POST', headers: { cookie } });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/login.html');
  assert.match(response.headers.get('Set-Cookie'), /^pala_auth=; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=0;/);
  assert.equal((await call('/kids.html')).headers.get('Location'), '/login.html');
  assert.equal((await setup({ SITE_PASSWORD: undefined }).call('/logout', { method: 'POST' })).status, 302);
  assert.equal(await (await call('/js/theme.js')).text(), 'allowed');
});

test('both configured passwords issue signed cookies that permit access', async () => {
  const { call, login } = setup();
  for (const password of ['primary-password', 'secondary-password']) {
    const response = await login(password);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), '/');
    const cookie = response.headers.get('Set-Cookie');
    assert.match(cookie, /^pala_auth=v1\.\d+\.[a-f0-9]{64};/);
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    assert.equal(await (await call('/ielts.html', { headers: { cookie: cookie.split(';')[0] } })).text(), 'allowed');
  }
});

test('unsigned, tampered, expired and incorrectly named cookies cannot bypass login', async () => {
  const { call, login, sandbox } = setup();
  const response = await login('primary-password');
  const valid = response.headers.get('Set-Cookie').split(';')[0];
  const token = valid.slice('pala_auth='.length);
  const expiredPayload = `v1.${Math.floor(Date.now() / 1000) - 1}`;
  const key = await vm.runInNewContext("sessionKey('student:primary-password')", sandbox);
  const signature = Buffer.from(await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(expiredPayload))).toString('hex');
  for (const cookie of ['pala_auth=true', 'other_pala_auth=true', `other_${valid}`,
    `${valid.slice(0, -1)}${valid.endsWith('a') ? 'b' : 'a'}`, `pala_auth=${expiredPayload}.${signature}`,
    `pala_auth=${token.replace(/\.\d+\./, '.9999999999.')}`]) {
    const denied = await call('/ielts.html', { headers: { cookie } });
    assert.equal(denied.status, 302, cookie);
    assert.equal(denied.headers.get('Location'), '/login.html');
  }
});

test('invalid login, missing configuration and public-path lookalikes fail closed', async () => {
  const { call, login } = setup();
  assert.equal((await login('wrong')).headers.get('Location'), '/login.html?error=1');
  assert.equal((await setup({ SITE_PASSWORD: undefined }).call('/ielts.html')).status, 503);
  assert.equal((await setup({ SECONDARY_SITE_PASSWORD: undefined }).login('')).headers.get('Location'), '/login.html?error=1');
  for (const path of ['/admin-extra.html', '/login.html-private', '/src-private/data']) {
    assert.equal((await call(path)).status, 302);
  }
  for (const path of ['/admin', '/admin.html', '/login.html', '/src/test-system.css', '/images/Pala_logo.png', '/header.html', '/footer.html', '/js/main.js']) {
    assert.equal(await (await call(path)).text(), 'allowed');
  }
  assert.equal((await call('/login', { method: 'POST', body: 'not form data' })).headers.get('Location'), '/login.html?error=1');
});

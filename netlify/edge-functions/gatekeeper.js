const SESSION_SECONDS = 86400;
const encoder = new TextEncoder();

function redirect(location, cookie) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 302, headers });
}

async function sessionKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function createSession(key) {
  const payload = `v1.${Math.floor(Date.now() / 1000) + SESSION_SECONDS}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const hex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${payload}.${hex}`;
}

async function validSession(token, key) {
  const match = /^v1\.(\d{10,})\.([a-f0-9]{64})$/.exec(token || '');
  if (!match) return false;
  const expiry = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + SESSION_SECONDS) return false;
  const signature = Uint8Array.from(match[2].match(/../g), byte => parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(`v1.${match[1]}`));
}

export default async (request, context) => {
  const url = new URL(request.url);
  const publicPages = ['/login.html', '/admin.html', '/admin'];
  const publicDirectories = ['/images/', '/src/'];
  if (publicPages.includes(url.pathname) || publicDirectories.some(path => url.pathname.startsWith(path))) {
    return context.next();
  }

  const expectedUser = Netlify.env.get('SITE_USERNAME');
  const expectedPass = Netlify.env.get('SITE_PASSWORD');
  const secondaryPass = Netlify.env.get('SECONDARY_SITE_PASSWORD');
  // Existing deployments need no new variable; a dedicated signing secret is optional.
  const secret = Netlify.env.get('SITE_SESSION_SECRET') || expectedPass;
  if (!expectedUser || !expectedPass || !secret) {
    return new Response('Đăng nhập chưa được cấu hình. Vui lòng liên hệ trung tâm.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const key = await sessionKey(`${expectedUser}:${secret}`);

  if (url.pathname === '/login' && request.method === 'POST') {
    let formData;
    try { formData = await request.formData(); }
    catch { return redirect('/login.html?error=1'); }
    const user = formData.get('username');
    const pass = formData.get('password');
    if (user === expectedUser && (pass === expectedPass || (secondaryPass && pass === secondaryPass))) {
      const token = await createSession(key);
      return redirect('/', `pala_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
    }
    return redirect('/login.html?error=1');
  }

  const token = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith('pala_auth='))?.slice('pala_auth='.length);
  if (!await validSession(token, key)) return redirect('/login.html');
  return context.next();
};

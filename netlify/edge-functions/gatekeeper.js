export default async (request, context) => {
  const url = new URL(request.url);

  // 1. Define public paths that NEVER require a password
  // We must let them see the login page and the logo image!
  const publicPaths = ['/login.html', '/images/'];
  if (publicPaths.some(path => url.pathname.startsWith(path))) {
    return context.next();
  }

  // Fetch expected credentials
  const expectedUser = Netlify.env.get("SITE_USERNAME")
  const expectedPass = Netlify.env.get("SITE_PASSWORD")

  // 2. Handle the form submission from login.html
  if (url.pathname === '/login' && request.method === 'POST') {
    // Read the submitted form data
    const formData = await request.formData();
    const user = formData.get('username');
    const pass = formData.get('password');

    if (user === expectedUser && pass === expectedPass) {
      // SUCCESS: Set a secure cookie valid for 1 day (86400 seconds)
      // and redirect them to the homepage (index.html)
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': 'pala_auth=true; Path=/; HttpOnly; Secure; Max-Age=86400'
        }
      });
    } else {
      // FAILURE: Redirect back to login page with an error flag in the URL
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/login.html?error=1'
        }
      });
    }
  }

  // 3. For all other pages, check if they have the authentication cookie
  const cookies = request.headers.get("cookie");
  if (!cookies || !cookies.includes("pala_auth=true")) {
    // No cookie found? Kick them back to the login page
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/login.html'
      }
    });
  }

  // 4. They have the cookie! Let them view the page
  return context.next();
};
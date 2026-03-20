import type { Context } from "@netlify/edge-functions";

export default async (request: Request, context: Context) => {
  // 1. Fetch expected credentials from Netlify Environment Variables
  // (We use fallback values here just in case they aren't set yet)
  const expectedUser = Deno.env.get("SITE_USERNAME") || "admin";
  const expectedPass = Deno.env.get("SITE_PASSWORD") || "password123";

  // 2. Look for the 'Authorization' header in the incoming request
  const authHeader = request.headers.get("authorization");

  if (authHeader) {
    // Basic Auth sends credentials in the format: "Basic base64encoded(user:pass)"
    const match = authHeader.match(/^Basic\s+(.*)$/);
    
    if (match) {
      // Decode the base64 string
      const credentials = atob(match[1]);
      
      // 3. Check if the decoded string matches our expected username:password
      if (credentials === `${expectedUser}:${expectedPass}`) {
        // Success! Allow the request to proceed to your site
        return context.next();
      }
    }
  }

  // 4. If no credentials were provided or they were wrong, reject the request
  // The 'WWW-Authenticate' header tells the browser to show the login popup
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Secure Site Area"',
    },
  });
};
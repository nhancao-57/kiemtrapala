export default async (request, context) => {
  const expectedUser = Netlify.env.get("SITE_USERNAME") || "admin";
  const expectedPass = Netlify.env.get("SITE_PASSWORD") || "password123";

  const authHeader = request.headers.get("authorization");

  if (authHeader) {
    const match = authHeader.match(/^Basic\s+(.*)$/);
    
    if (match) {
      const credentials = atob(match[1]);
      
      if (credentials === `${expectedUser}:${expectedPass}`) {
        return context.next();
      }
    }
  }

  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Secure Site Area"',
    },
  });
};
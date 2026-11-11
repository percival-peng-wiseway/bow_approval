// Keep the original URL, Origin, cookies and body. The BOW Worker remains
// responsible for authentication, CSRF checks, private files and static assets.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;
    if (host === 'oa.wiseway.ai') {
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response('Please use https://bowoa.wiseway.ai', { status: 410 });
      }
      url.hostname = 'bowoa.wiseway.ai';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    if (!['bowoa.wiseway.ai', 'bow-oa.pages.dev'].includes(host)) {
      return new Response('Not found', { status: 404 });
    }
    if (!env.BOW?.fetch) {
      return new Response('BOW OA is temporarily unavailable.', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return env.BOW.fetch(request);
  },
};

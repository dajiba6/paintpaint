// Only a fixed public Tunnel route is forwarded; never proxy user-supplied hosts.
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const target = new URL(env.ORIGIN_URL);
    target.pathname = `${target.pathname.replace(/\/$/, '')}${incoming.pathname}`;
    target.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('X-Forwarded-Host', incoming.host);
    headers.set('X-Forwarded-Proto', 'https');
    return fetch(new Request(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    }));
  },
};

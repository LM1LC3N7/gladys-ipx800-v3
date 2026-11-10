// -----------------------------------------------------------------------------
// A fake IPX800 V3 on a REAL local HTTP server (127.0.0.1, the kit's
// httpServer), for the scenarios on a real clock: two of them stand for two
// boxes of one house. It answers `globalstatus.xml` (unless `global` is
// false: a 404, only `status.xml`), `status.xml` and `preset.htm?setN=0|1`;
// with a user, every request needs its Basic credentials. Any other path is
// a 404, as an IPX800 V4 or V5 would answer. Every write is recorded.
// -----------------------------------------------------------------------------

import { httpServer, reply } from '../kit/index.mjs';
import { applyPreset, basic, v3State, v3Xml } from './xml.js';

/** `{ srv, state, writes(), address }`: close with `srv.close()`. */
export async function httpIpx({
  user = '',
  password = '',
  latencyMs = 3,
  global = true,
  statusXml = v3Xml,
} = {}) {
  const state = { ...v3State(), user, password, global, writes: [] };
  const route = (r) => {
    if (state.user !== '' && r.headers.authorization !== basic(state.user, state.password)) {
      return reply(401, '<html>401 Unauthorized</html>');
    }
    if (r.path === '/globalstatus.xml' && state.global) return reply(200, statusXml(state));
    if (r.path === '/status.xml') return reply(200, statusXml(state));
    if (r.path === '/preset.htm') {
      const query = new URLSearchParams(r.url.split('?')[1] ?? '');
      state.writes.push(query.toString());
      if (!applyPreset(state, query)) return reply(400, '<html>bad</html>');
      return reply(200, '<html><body>IPX800 V3</body></html>');
    }
    return undefined;
  };
  const srv = await httpServer({ latencyMs, routes: {} });
  // Every path through one handler (the kit matches exact paths only).
  srv.routes = new Proxy({}, { get: () => route });
  return {
    srv,
    state,
    address: `127.0.0.1:${srv.port}`,
    writes: () => [...state.writes],
  };
}

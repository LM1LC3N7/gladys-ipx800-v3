import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEGACY_POLL_INTERVAL, POLL_MS } from '../src/constants.js';
import {
  DEFAULTS,
  credentialsOf,
  isComplete,
  normalizeConfig,
  parseAddress,
  parseExtensions,
  parsePassword,
  parseRelays,
  parseUser,
  roundInterval,
  sessionKey,
  slotConfig,
  slotTyped,
} from '../src/config.js';

test('addresses: IP, name, port; a pasted URL, https, broadcast, multicast refused', () => {
  assert.deepEqual(parseAddress('192.168.1.50'), { host: '192.168.1.50', port: 80 });
  assert.deepEqual(parseAddress('http://ipx800.lan:8080/'), { host: 'ipx800.lan', port: 8080 });
  assert.deepEqual(parseAddress('http://192.168.1.50/globalstatus.xml'), { error: 'path' });
  assert.deepEqual(parseAddress('http://admin:pw@192.168.1.50'), { error: 'path' });
  assert.deepEqual(parseAddress('https://192.168.1.50'), { error: 'https' });
  assert.deepEqual(parseAddress('255.255.255.255'), { error: 'invalid' });
  assert.deepEqual(parseAddress('224.0.0.1'), { error: 'invalid' });
  assert.deepEqual(parseAddress('0.0.0.0'), { error: 'invalid' });
  assert.deepEqual(parseAddress('[ff02::1]'), { error: 'invalid' });
  assert.deepEqual(parseAddress('::'), { error: 'invalid' });
  assert.deepEqual(parseAddress('192.168.1.50:0'), { error: 'invalid' });
  assert.deepEqual(parseAddress('192.168.1.50:65536'), { error: 'invalid' });
  assert.deepEqual(parseAddress('ipx\r\nX: 1'), { error: 'path' });
  assert.deepEqual(parseAddress(''), {});
});

test('user and password: printable, bounded, no control character; user without ":"', () => {
  assert.equal(parseUser(' admin '), 'admin');
  assert.equal(parseUser(''), '');
  assert.equal(parseUser(undefined), '');
  assert.equal(parseUser('ad:min'), null);
  assert.equal(parseUser('ad min'), null);
  assert.equal(parseUser('a\r\nX-Evil: 1'), null);
  assert.equal(parseUser('x'.repeat(65)), null);
  assert.equal(parsePassword('pass word:1'), 'pass word:1');
  assert.equal(parsePassword('a\nb'), null);
  assert.equal(parsePassword('é'), null, 'ASCII only (Basic authentication)');
  assert.equal(parsePassword('x'.repeat(65)), null);
  assert.equal(normalizeConfig({ host: 'h', password: 'p' }).credentialsError, 'passwordAlone');
  assert.equal(normalizeConfig({ host: 'h', username: 'u' }).credentialsError, 'userAlone');
  assert.equal(normalizeConfig({ host: 'h', username: 'u:' }).credentialsError, 'user');
  assert.equal(
    normalizeConfig({ host: 'h', username: 'u', password: 'p' }).credentialsError,
    undefined,
  );
  assert.equal(isComplete(normalizeConfig({ host: 'h', password: 'p' })), false);
  assert.equal(isComplete(normalizeConfig({ host: 'h' })), true, 'no credentials: complete');
  assert.equal(credentialsOf(normalizeConfig({ host: 'h' })), '');
});

test('relays Gladys may drive: R1-R32; kinds switch or light; errors reported', () => {
  const { relays, errors } = parseRelays('R1, 3:light; r32\nR33, R0, X8R12-1, R2:pump');
  assert.deepEqual(
    [...relays],
    [
      ['r1', 'switch'],
      ['r3', 'light'],
      ['r32', 'switch'],
    ],
  );
  assert.deepEqual(errors, ['R33', 'R0', 'X8R12-1', 'R2:pump']);
});

test('relays Gladys may drive: a range R1-R8 (cce66), with a kind; a wrong range lists nothing of it', () => {
  const { relays, errors } = parseRelays('R1-R8, 9 - 10:light, r12-R12');
  assert.deepEqual(errors, []);
  assert.deepEqual(
    [...relays.keys()],
    ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r12'],
  );
  assert.equal(relays.get('r8'), 'switch');
  assert.equal(relays.get('r9'), 'light');
  assert.equal(relays.get('r10'), 'light');
  const wrong = parseRelays('R8-R1, R30-R33, R0-R2, R1-, -R3, R1-R2-R3, R1-D4, R1-R2:pump');
  assert.equal(wrong.relays.size, 0, 'backwards, past R32, from R0, half or another kind');
  assert.deepEqual(wrong.errors, [
    'R8-R1',
    'R30-R33',
    'R0-R2',
    'R1-',
    '-R3',
    'R1-R2-R3',
    'R1-D4',
    'R1-R2:pump',
  ]);
  assert.equal(parseRelays('R1-R32').relays.size, 32);
  const both = parseRelays('R1-R8, R5:light, R5');
  assert.equal(both.relays.get('r5'), 'switch', 'the first kind kept');
  assert.deepEqual(both.errors, [], 'understood: not "not understood"');
  assert.deepEqual(both.conflicts, [{ code: 'r5', kind: 'switch' }], 'R5 again is no conflict');
  const later = parseRelays('R5:light, R1-R8');
  assert.equal(later.relays.get('r5'), 'light');
  assert.equal(later.relays.get('r1'), 'switch', 'the rest of the entry applies');
  assert.deepEqual(later.errors, []);
  assert.deepEqual(later.conflicts, [{ code: 'r5', kind: 'light' }]);
  assert.deepEqual(parseRelays('R1-R4, R3-R8:light').conflicts, [
    { code: 'r3', kind: 'switch' },
    { code: 'r4', kind: 'switch' },
  ]);
  assert.deepEqual(parseRelays('R1, R1-R2, r2').conflicts, [], 'a same-kind repeat is no conflict');
  assert.equal(parseRelays('R5:light, R1-R8').relays.size, 8);
});

test('the read pace: ms, 1000 to 300000; 0 (or empty) = 10 s', () => {
  const pace = (raw) => normalizeConfig(raw).pollMs;
  assert.equal(pace({}), POLL_MS.default);
  assert.equal(POLL_MS.default, 10_000, 'the default of 0.2.x (10 s)');
  assert.equal(pace({ inputs_poll_ms: '' }), 10_000);
  assert.equal(pace({ inputs_poll_ms: null }), 10_000);
  assert.equal(pace({ inputs_poll_ms: 'abc' }), 10_000);
  assert.equal(pace({ inputs_poll_ms: 0 }), 10_000, '0: the way back');
  assert.equal(pace({ inputs_poll_ms: '0' }), 10_000);
  assert.equal(pace({ inputs_poll_ms: -5 }), 10_000);
  assert.equal(pace({ inputs_poll_ms: 1 }), POLL_MS.min);
  assert.equal(pace({ inputs_poll_ms: 999 }), 1000, 'never faster than 1 s');
  assert.equal(pace({ inputs_poll_ms: 1000 }), 1000);
  assert.equal(pace({ inputs_poll_ms: 2000 }), 2000);
  assert.equal(pace({ inputs_poll_ms: 300_000 }), 300_000);
  assert.equal(pace({ inputs_poll_ms: 10 ** 9 }), POLL_MS.max);
  assert.equal(pace({ inputs_poll_ms: '1500.4' }), 1500);
  assert.equal(pace({ inputs_poll_ms: Infinity }), 10_000);
  assert.equal(POLL_MS.min, 1000, 'one request a second at most for the small web server');
  assert.equal(POLL_MS.max, 300_000);
  assert.equal(roundInterval(normalizeConfig({ inputs_poll_ms: 2000 })), 2000);
  assert.equal(roundInterval(normalizeConfig({})), 10_000);
});

test('migration from 0.2.x: inputs_poll_ms set wins, otherwise the seconds of poll_interval', () => {
  const pace = (raw) => normalizeConfig(raw).pollMs;
  // cce66 (t/11448 #16): 5 s and 1000 ms.
  assert.equal(pace({ poll_interval: 5, inputs_poll_ms: 1000 }), 1000);
  // Set, it wins even when slower than the seconds (the one field the form shows now).
  assert.equal(pace({ poll_interval: 5, inputs_poll_ms: 60_000 }), 60_000);
  // Not set (absent, emptied, 0): the seconds kept by Gladys, read as 0.2.x read them.
  assert.equal(pace({ poll_interval: 30 }), 30_000);
  assert.equal(pace({ poll_interval: 30, inputs_poll_ms: 0 }), 30_000, '0 meant the seconds too');
  assert.equal(pace({ poll_interval: 30, inputs_poll_ms: '' }), 30_000);
  assert.equal(pace({ poll_interval: 30, inputs_poll_ms: null }), 30_000);
  assert.equal(pace({ poll_interval: 10 }), 10_000, 'the 0.2.x default the form saved');
  assert.equal(pace({ poll_interval: 300 }), 300_000);
  assert.equal(pace({ poll_interval: '45' }), 45_000);
  assert.equal(pace({ poll_interval: 1 }), 5000, 'below 5: 5 s, as 0.2.x read it');
  assert.equal(pace({ poll_interval: 0 }), 5000, 'as 0.2.x read it');
  assert.equal(pace({ poll_interval: 10_000 }), 300_000, 'above 300: 300 s, as 0.2.x');
  assert.equal(pace({ poll_interval: '' }), 10_000);
  assert.equal(pace({ poll_interval: 'abc' }), 10_000);
  assert.equal(pace({ poll_interval: 7.6 }), 8000);
  // Every pace 0.2.x could read stays within the new bounds.
  for (const seconds of [LEGACY_POLL_INTERVAL.min, LEGACY_POLL_INTERVAL.max]) {
    const ms = pace({ poll_interval: seconds });
    assert.ok(ms >= POLL_MS.min && ms <= POLL_MS.max, `${seconds} s`);
  }
});

test('migration: the Gladys form of 0.2.2 never saves over the seconds kept from 0.2.x', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
  );
  const schema = manifest.config_schema.filter((f) => f.type !== 'section');
  assert.ok(!schema.some((f) => f.key === 'poll_interval'), 'one field only');
  // What 0.2.1 kept (its form saved the default 10, or what the user typed), the field of the
  // inputs never typed.
  const stored = { host: '192.168.1.50', poll_interval: 30 };
  // The front (config-page/index.js, applySchemaDefaults): the stored values of the schema
  // keys, completed with the declared defaults; the server writes only the keys received.
  const form = {};
  for (const field of schema) {
    const value = stored[field.key] ?? field.default;
    if (value !== undefined && field.type !== 'secret') form[field.key] = value;
  }
  assert.equal(form.inputs_poll_ms, undefined, 'no default filled in');
  const saved = { ...stored, ...form };
  assert.equal(normalizeConfig(saved).pollMs, 30_000, 'Save keeps the 30 s');
  // The user types 2000, then 0 (the way back): 2 s, then the 30 s kept.
  assert.equal(normalizeConfig({ ...saved, inputs_poll_ms: 2000 }).pollMs, 2000);
  assert.equal(normalizeConfig({ ...saved, inputs_poll_ms: 0 }).pollMs, 30_000);
});

test('extensions: ranges by prefix, bounded to 32', () => {
  const { codes, errors } = parseExtensions('R9-R16, D9-24, R12, R33, R9-D10, D5-D2, A5, FP1');
  assert.equal(codes.size, 8 + 16);
  assert.ok(codes.has('r16') && codes.has('d24'));
  assert.deepEqual(errors, ['R33', 'R9-D10', 'D5-D2', 'A5', 'FP1']);
});

test('defaults; a session is the address, port and credentials; the key holds no secret', () => {
  const config = normalizeConfig({});
  assert.equal(config.pollMs, 10_000);
  assert.equal(config.language, DEFAULTS.language);
  assert.equal(config.language, 'fr');
  const a = normalizeConfig({ host: '10.0.0.2', username: 'u', password: 'p1' });
  const b = normalizeConfig({ host: '10.0.0.2', username: 'u', password: 'p1', relays: 'R1' });
  const c = normalizeConfig({ host: '10.0.0.2', username: 'u', password: 'p2' });
  assert.equal(sessionKey(a), sessionKey(b));
  assert.notEqual(sessionKey(a), sessionKey(c));
  assert.equal(normalizeConfig({ host: '10.0.0.2:8080' }).port, 8080);
  assert.equal(a.key, c.key, 'the controller key is the address and port only');
  assert.notEqual(a.key, normalizeConfig({ host: '10.0.0.2:8080' }).key);
  assert.ok(!a.key.includes('p1') && !a.key.includes('10.0.0.2'));
});

test('slots: the keys of slot n with _n, the read pace (and the 0.2.x seconds) and language shared', () => {
  const raw = {
    host: 'a',
    host_2: 'b',
    password_3: 'x',
    poll_interval: 20,
    inputs_poll_ms: 1500,
    relays_2: 'R2',
  };
  assert.deepEqual(slotConfig(raw, 2), {
    host: 'b',
    username: undefined,
    password: undefined,
    relays: 'R2',
    extensions: undefined,
    poll_interval: 20,
    inputs_poll_ms: 1500,
    language: undefined,
  });
  assert.equal(normalizeConfig(slotConfig(raw, 3)).pollMs, 1500);
  assert.equal(normalizeConfig(slotConfig({ host_2: 'b', poll_interval: 20 }, 2)).pollMs, 20_000);
  assert.equal(slotTyped(raw, 2), true);
  assert.equal(slotTyped(raw, 3), true, 'a password typed makes the slot used');
  assert.equal(slotTyped({}, 3), false);
});

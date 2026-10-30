import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('extensions: ranges by prefix, bounded to 32', () => {
  const { codes, errors } = parseExtensions('R9-R16, D9-24, R12, R33, R9-D10, D5-D2, A5, FP1');
  assert.equal(codes.size, 8 + 16);
  assert.ok(codes.has('r16') && codes.has('d24'));
  assert.deepEqual(errors, ['R33', 'R9-D10', 'D5-D2', 'A5', 'FP1']);
});

test('defaults; a session is the address, port and credentials; the key holds no secret', () => {
  const config = normalizeConfig({});
  assert.equal(config.pollInterval, DEFAULTS.poll_interval);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: 1 }).pollInterval, 5);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollInterval, 10);
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

test('slots: the keys of slot n with _n, the poll interval and language shared', () => {
  const raw = { host: 'a', host_2: 'b', password_3: 'x', poll_interval: 20, relays_2: 'R2' };
  assert.deepEqual(slotConfig(raw, 2), {
    host: 'b',
    username: undefined,
    password: undefined,
    relays: 'R2',
    extensions: undefined,
    poll_interval: 20,
    language: undefined,
  });
  assert.equal(slotTyped(raw, 2), true);
  assert.equal(slotTyped(raw, 3), true, 'a password typed makes the slot used');
  assert.equal(slotTyped({}, 3), false);
});

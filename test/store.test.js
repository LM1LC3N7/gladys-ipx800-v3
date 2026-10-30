import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore, normalizeMemory } from '../src/store.js';

test('fileStore: atomic 0600 write, missing = null, unreadable throws', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ipx800-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  const store = fileStore(path);
  assert.equal(await store.load(), null);
  await Promise.all([store.save({ a: 1 }), store.save({ a: 2 })]);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { a: 2 });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await writeFile(path, '{not json');
  await assert.rejects(store.load());
});

test('normalizeMemory: bounded, dates brought to now, guards checked, another key starts empty', () => {
  const now = Date.UTC(2026, 9, 27);
  const memory = normalizeMemory(
    {
      lastAttemptAt: now + 3600_000,
      key: 'a'.repeat(32),
      pause: { until: now + 100 * 3600_000, failures: 99, code: 'busy' },
      refused: { salt: 'b'.repeat(32), tag: 300 },
      guards: [
        { code: 'r3', kind: 'relay', value: 0, resends: 2, confirmed: false, other: 1 },
        { code: 'r3', kind: 'relay', value: 0 },
        { code: '__proto__', kind: 'relay', value: 0 },
        { code: 'r1', kind: 'relay', value: 9 },
        { code: 'r2', kind: 'relay', value: 1 },
        { code: 'd1', kind: 'relay', value: 0 },
        { code: 'r4', kind: 'pilot-wire', value: 0 },
        { code: 'r5', kind: 'relay', value: 0, other: 7 },
      ],
    },
    now,
  );
  assert.equal(memory.lastAttemptAt, now);
  assert.equal(memory.pause.until, now + 3600_000);
  assert.equal(memory.pause.failures, 10);
  assert.equal(memory.refused, null);
  assert.deepEqual(
    memory.guards.map((g) => g.code),
    ['r3', 'r5'],
  );
  assert.equal(memory.guards[0].resends, 2);
  assert.equal(memory.guards[0].other, 1);
  assert.equal(memory.guards[1].other, undefined);
  assert.deepEqual(normalizeMemory({ key: 'nope', guards: [{ code: 'r1' }] }).guards, []);
});

test('normalizeMemory: the owner is an address key only; anything else is none', () => {
  const key = 'c'.repeat(32);
  assert.equal(normalizeMemory({ key, guards: [] }).owner, null);
  assert.equal(normalizeMemory(null).owner, null, 'a fresh install');
  const owner = { kind: 'address', id: 'd'.repeat(32) };
  assert.deepEqual(normalizeMemory({ format: 1, key, owner, salt: 'e'.repeat(32) }).owner, owner);
  assert.equal(normalizeMemory({ format: 1, key, salt: 'e'.repeat(32) }).salt, 'e'.repeat(32));
  for (const bad of [
    { kind: 'mac', id: 'd'.repeat(32) },
    { kind: 'address', id: '192.168.1.50' },
    { kind: 'address' },
    'address',
  ]) {
    assert.equal(normalizeMemory({ format: 1, key, owner: bad }).owner, null, JSON.stringify(bad));
  }
  assert.equal(normalizeMemory({ format: 1, key, salt: 'nope' }).salt, '');
  // The owner survives another controller key (it is about the devices, not the address).
  assert.deepEqual(normalizeMemory({ format: 1, key: 'f'.repeat(32), owner }).owner, owner);
});

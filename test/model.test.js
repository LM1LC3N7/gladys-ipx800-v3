import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analogValue, parseV3, parseXml, v3Codes, v3Kind, v3WriteQuery } from '../src/ipx/model.js';
import { v3State, v3Xml } from './helpers/xml.js';

test('parseXml: a flat status page; no relay = not a V3; an element twice is unknown', () => {
  const { fields } = parseXml(Buffer.from(v3Xml(v3State()), 'latin1'));
  assert.equal(fields.get('led0'), '0');
  assert.equal(fields.get('btn31'), 'up');
  assert.equal(fields.get('anselect0'), '2');
  assert.deepEqual(parseXml('{"product":"IPX800_V4","status":"Success"}'), {
    error: 'bad_response',
  });
  assert.deepEqual(parseXml('<html><body>Login</body></html>'), { error: 'bad_response' });
  const twice = parseXml('<response><led0>1</led0><led0>0</led0><led1> 1 </led1></response>');
  assert.equal(twice.fields.get('led0'), undefined);
  assert.equal(twice.fields.get('led1'), '1');
});

test('parseXml: "__proto__" and "constructor" pollute nothing; a huge answer stays bounded and linear', () => {
  const { fields } = parseXml(
    '<response><led0>1</led0><__proto__>x</__proto__><constructor>1</constructor></response>',
  );
  assert.equal({}.x, undefined);
  assert.equal(fields.get('led0'), '1');
  const many = `<response>${'<led0>1</led0>'.repeat(5000)}${'<a>'.repeat(20000)}</response>`;
  const started = performance.now();
  const parsed = parseXml(many);
  assert.ok(performance.now() - started < 500);
  assert.equal(parsed.fields.get('led0'), undefined, 'given many times: unknown');
  const nested = parseXml(`<response><led0><b>1</b></led0>${'<'.repeat(60000)}</response>`);
  assert.equal(nested.error, 'bad_response', 'markup inside an element is not a value');
});

test('values strict: relays 0/1, inputs up/dn, never a text or an empty value as 0', () => {
  const fields = new Map([
    ['led0', '1'],
    ['led1', '01'],
    ['led2', ''],
    ['led3', 'on'],
    ['btn0', 'dn'],
    ['btn1', 'up'],
    ['btn2', '1'],
    ['btn3', 'DN'],
  ]);
  const t = parseV3(fields, ['r1', 'r2', 'r3', 'r4', 'r5', 'd1', 'd2', 'd3', 'd4', 'zz9']);
  assert.deepEqual(
    ['r1', 'r2', 'r3', 'r4'].map((c) => t.get(c).value),
    [1, undefined, undefined, undefined],
  );
  assert.ok(!t.has('r5'), 'no led4 in the answer: not on this IPX800');
  assert.deepEqual(
    ['d1', 'd2', 'd3', 'd4'].map((c) => t.get(c).value),
    [1, 0, undefined, undefined],
  );
  assert.ok(!t.has('zz9'));
});

test('analog inputs: the published sensor types converted; 0, 1023, a text or a value out of range is no reading', () => {
  assert.equal(analogValue('2', '222'), 21.7, 'TC4012: 222 x 0.323 - 50');
  assert.equal(analogValue('4', '700'), 19.4, 'SHT temperature');
  assert.equal(analogValue('6', '300'), 25.7, 'TC100');
  assert.equal(analogValue('5', '512'), 53.8, 'SHT humidity, 15 °C');
  assert.equal(analogValue('2', '0'), undefined, 'nothing wired');
  assert.equal(analogValue('6', '0'), undefined, 'nothing wired, though -8.9 °C would be in range');
  assert.equal(
    analogValue('6', '1023'),
    undefined,
    'an open input, though 109 °C would be in range',
  );
  assert.equal(analogValue('6', '1'), -8.8, 'the first raw value read');
  assert.equal(analogValue('2', '1023'), undefined, 'saturated');
  assert.equal(analogValue('2', '12.5'), undefined);
  assert.equal(analogValue('2', ''), undefined);
  assert.equal(analogValue('2', '-5'), undefined);
  assert.equal(analogValue('5', '100'), undefined, 'a humidity below 0 is no measure');
  assert.equal(analogValue('6', '1022'), 109, 'TC100 near the top of its input');
  assert.equal(analogValue('2', '1022'), undefined, 'TC4012 at 280 °C is out of range');
  for (const type of ['0', '1', '3', '7', '10', '12', '', undefined]) {
    assert.equal(analogValue(type, '512'), undefined, `type ${type} not published`);
  }
  const t = parseV3(
    new Map([
      ['analog0', '222'],
      ['anselect0', '2'],
      ['analog1', '512'],
      ['anselect1', '3'],
      ['analog2', '512'],
      ['anselect2', '0'],
    ]),
    ['a1', 'a2', 'a3', 'a4'],
  );
  assert.deepEqual(
    ['a1', 'a2', 'a3'].map((c) => [t.get(c).sensor, t.get(c).value, t.get(c).unhandled]),
    [
      ['temperature', 21.7, false],
      [undefined, undefined, true],
      [undefined, undefined, false],
    ],
  );
  assert.ok(!t.has('a4'), 'no analog3 in the answer');
});

test('the listed targets, the kinds and the write queries', () => {
  const codes = v3Codes(new Set(['r9', 'd12']), new Map([['r20', 'switch']]));
  assert.ok(codes.has('r8') && codes.has('d8') && codes.has('a4') && codes.has('r20'));
  assert.ok(codes.has('r9') && codes.has('d12') && !codes.has('r10') && !codes.has('a5'));
  assert.equal(v3Kind('r32'), 'relay');
  assert.equal(v3Kind('r33'), undefined);
  assert.equal(v3Kind('a5'), undefined);
  assert.equal(v3Kind('d0'), undefined);
  assert.equal(v3WriteQuery({ kind: 'relay', n: 3 }, 1), 'set3=1');
  assert.equal(v3WriteQuery({ kind: 'relay', n: 32 }, 0), 'set32=0');
  assert.equal(v3WriteQuery({ kind: 'relay', n: 33 }, 0), undefined);
  assert.equal(v3WriteQuery({ kind: 'relay', n: 3 }, 2), undefined);
  assert.equal(v3WriteQuery({ kind: 'input', n: 1 }, 1), undefined);
});

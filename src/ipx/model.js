// -----------------------------------------------------------------------------
// What the answers of the IPX800 V3 mean (pure): the targets the integration
// knows and their values. A target is
//   { code, kind, n, value, sensor?, unhandled? }
// `value`: 0 / 1 for a relay or an input, a number (°C, %) for an analog
// input; `undefined` when the answer does not give it (absent, a text, out of
// range, twice: never 0). `sensor`: the feature of an analog input, from its
// sensor type (`anselect<i>`); undefined for a type not published.
//
// The status page is a flat XML document (`<response><led0>0</led0>...`): it
// is read with one bounded, linear pattern (no XML library, no entity, no
// nesting), every element kept in a Map (nothing the IPX sends becomes an
// object key: no prototype pollution), at most LIMITS.xmlElements of them.
// -----------------------------------------------------------------------------

import { ANALOG_TYPES, KINDS, LIMITS, LIMITS_V3, RANGES } from '../constants.js';

/** One element `<name>text</name>`, text without markup, both bounded. */
const ELEMENT = /<([A-Za-z][A-Za-z0-9_]{0,31})>([^<>]{0,256})<\/\1>/g;

/**
 * The elements of a status page: `{ fields: Map(name -> text) }`, or
 * `{ error: 'bad_response' }` when it holds no relay (`led<n>`): not the
 * status of an IPX800 V3. An element given twice is unknown (undefined).
 */
export function parseXml(body) {
  const text = Buffer.isBuffer(body) ? body.toString('latin1') : String(body ?? '');
  const fields = new Map();
  let count = 0;
  for (const match of text.matchAll(ELEMENT)) {
    if (count >= LIMITS.xmlElements) break;
    count += 1;
    const name = match[1].toLowerCase();
    fields.set(name, fields.has(name) ? undefined : match[2].trim());
  }
  if (![...fields.keys()].some((name) => /^led\d{1,2}$/.test(name))) {
    return { error: 'bad_response' };
  }
  return { fields };
}

/**
 * The answer a V3 gives while it is not ready (seen on a real one, ha_ipx800v3 e90a553): every
 * analog value 0 and `dnsstatus` "pending"; its other values (relays and inputs at 0) are not
 * readings. Single source: see TODO.md.
 */
export function isPendingAnswer(fields) {
  let sum = 0;
  for (const [name, text] of fields) {
    if (/^analog\d{1,2}$/.test(name) && typeof text === 'string' && /^\d{1,5}$/.test(text)) {
      sum += Number(text);
    }
  }
  const dns = fields.get('dnsstatus');
  return sum === 0 && typeof dns === 'string' && dns.toLowerCase().includes('pending');
}

/** The targets listed: the 8 relays and inputs of the IPX, its 4 analog inputs, the extensions. */
export function v3Codes(extensions, relays) {
  const codes = new Set();
  for (let n = 1; n <= LIMITS_V3.own; n += 1) {
    codes.add(`r${n}`);
    codes.add(`d${n}`);
  }
  for (let n = 1; n <= LIMITS_V3.analogs; n += 1) codes.add(`a${n}`);
  for (const code of extensions ?? []) codes.add(code);
  // A relay declared drivable is listed even without its extension line.
  for (const code of relays?.keys() ?? []) {
    if (/^r\d+$/.test(code)) codes.add(code);
  }
  return codes;
}

/** The kind of a code; undefined when not one. */
export function v3Kind(code) {
  const match = /^(r|d|a)(\d{1,2})$/.exec(code);
  if (!match) return undefined;
  const n = Number(match[2]);
  const max = { r: LIMITS_V3.relays, d: LIMITS_V3.inputs, a: LIMITS_V3.analogs }[match[1]];
  if (n < 1 || n > max) return undefined;
  return { r: KINDS.RELAY, d: KINDS.INPUT, a: KINDS.ANALOG }[match[1]];
}

/** The number of a code (`r12` -> 12). */
export const numberOf = (code) => Number(/\d+$/.exec(code)?.[0]);

/** A relay: `0` / `1` only. */
const relayBit = (text) => (text === '0' ? 0 : text === '1' ? 1 : undefined);

/** An input: `dn` (closed, on) / `up` (open, off), as ha_ipx800v3 reads them. */
const inputBit = (text) => (text === 'dn' ? 1 : text === 'up' ? 0 : undefined);

/** A raw analog value: an integer within RANGES.raw (0 and 1023 are not readings). */
function rawOf(text) {
  if (typeof text !== 'string' || !/^\d{1,4}$/.test(text)) return undefined;
  const raw = Number(text);
  return raw >= RANGES.raw.min && raw <= RANGES.raw.max ? raw : undefined;
}

/** The feature of an analog sensor type (`anselect<i>`); undefined when not published. */
export const sensorOf = (type) =>
  typeof type === 'string' ? ANALOG_TYPES.get(type)?.feature : undefined;

/** An analog measure, rounded to 0.1, within its range; undefined otherwise. */
export function analogValue(type, text) {
  const spec = typeof type === 'string' ? ANALOG_TYPES.get(type) : undefined;
  const raw = rawOf(text);
  if (!spec || raw === undefined) return undefined;
  const value = Math.round(spec.convert(raw) * 10) / 10;
  const range = RANGES[spec.feature];
  return Number.isFinite(value) && value >= range.min && value <= range.max ? value : undefined;
}

/** The element of the status page that holds the value of a code. */
const elementOf = (kind, n) =>
  kind === KINDS.RELAY ? `led${n - 1}` : kind === KINDS.INPUT ? `btn${n - 1}` : `analog${n - 1}`;

/**
 * The status fields -> Map(code -> target) for the codes asked. A code whose element is not
 * in the answer is not on this IPX800 (no target); an element there but unreadable gives a
 * target without value.
 */
export function parseV3(fields, codes) {
  const targets = new Map();
  for (const code of codes) {
    const kind = v3Kind(code);
    if (!kind) continue;
    const n = numberOf(code);
    if (!fields.has(elementOf(kind, n))) continue;
    if (kind === KINDS.RELAY) {
      targets.set(code, { code, kind, n, value: relayBit(fields.get(`led${n - 1}`)) });
    } else if (kind === KINDS.INPUT) {
      targets.set(code, { code, kind, n, value: inputBit(fields.get(`btn${n - 1}`)) });
    } else {
      const type = fields.get(`anselect${n - 1}`);
      const sensor = sensorOf(type);
      targets.set(code, {
        code,
        kind,
        n,
        sensor,
        // A sensor type set on the IPX (not 0, "analog") that is not published (yet).
        unhandled: !sensor && typeof type === 'string' && /^\d{1,2}$/.test(type) && type !== '0',
        value: analogValue(type, fields.get(`analog${n - 1}`)),
      });
    }
  }
  return targets;
}

/** The query of a write: `set3=1` (relay 3 on), `set3=0` (off); undefined when not a relay. */
export function v3WriteQuery(target, value) {
  if (target.kind !== KINDS.RELAY) return undefined;
  if (!Number.isInteger(target.n) || target.n < 1 || target.n > LIMITS_V3.relays) return undefined;
  if (value !== 0 && value !== 1) return undefined;
  return `set${target.n}=${value}`;
}

// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
//
// Target codes (what the user types and reads in the device names), always
// stored lower case: `r<n>` relay 1-32 (`set<n>` of preset.htm, `led<n-1>`
// of the status), `d<n>` digital input 1-32 (`btn<n-1>`), `a<n>` analog
// input 1-4 (`analog<n-1>`).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { API, INPUTS_POLL_MS, LIMITS_V3, POLL_INTERVAL, RELAY_KINDS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * The address typed by the user: `{ host, port }`, `{ error: 'path' }` when it
 * holds a path, a query or credentials (a pasted URL, maybe with the
 * password), `{ error: 'https' }`, `{ error: 'invalid' }`, `{}` when empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return {};
  }
  if (/^https:\/\//i.test(text)) {
    return { error: 'https' };
  }
  text = text.replace(/^http:\/\//i, '').replace(/\/$/, '');
  if (/[/?#@\s]/.test(text)) {
    return { error: 'path' };
  }
  let host = text;
  let port;
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(text);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2];
  } else if (isIP(text) !== 6) {
    const withPort = /^([^:]+):(\d{1,5})$/.exec(text);
    if (withPort) {
      host = withPort[1];
      port = withPort[2];
    } else if (text.includes(':')) {
      return { error: 'invalid' };
    }
  }
  if (isIP(host) === 0 && !HOSTNAME.test(host)) {
    return { error: 'invalid' };
  }
  if (isIP(host) === 4 && /^(0\.|255\.255\.255\.255$|22[4-9]\.|23\d\.)/.test(host)) {
    // Neither "this network", the broadcast nor a multicast group.
    return { error: 'invalid' };
  }
  if (isIP(host) === 6 && /^(::|ff[0-9a-f]{2}:)/i.test(host)) {
    // Neither the unspecified address nor a multicast group.
    return { error: 'invalid' };
  }
  const portNumber = port === undefined ? API.defaultPort : Number(port);
  if (portNumber < 1 || portNumber > 65535) {
    return { error: 'invalid' };
  }
  return { host: host.toLowerCase(), port: portNumber };
}

/**
 * The key of a controller in /data, and the identity of the IPX800 its
 * devices belong to (the V3 API gives no MAC address, see TODO.md): a hash of
 * its address and port, never the credentials.
 */
export const controllerKey = (host, port) =>
  host
    ? createHash('sha256').update(`ipx800v3:${host}:${port}`, 'utf8').digest('hex').slice(0, 32)
    : '';

/**
 * A user name of the HTTP protection: printable ASCII without space nor ':'
 * (Basic authentication), 1 to 64 characters; '' when absent; null when invalid.
 */
export function parseUser(raw) {
  if (raw === undefined || raw === null) return '';
  const text = String(raw).trim();
  if (text === '') return '';
  return /^[\x21-\x39\x3b-\x7e]{1,64}$/.test(text) ? text : null;
}

/** A password: printable ASCII (spaces inside allowed), 1 to 64 characters; '' when absent; null when invalid. */
export function parsePassword(raw) {
  if (raw === undefined || raw === null) return '';
  const text = String(raw);
  if (text === '') return '';
  return /^[\x20-\x7e]{1,64}$/.test(text) ? text : null;
}

const RELAY = /^r(\d{1,2})$/;

/** A relay code, normalized (`r3`); undefined when invalid. */
export function relayCode(text) {
  const match = RELAY.exec(String(text).trim().toLowerCase());
  if (!match) return undefined;
  const n = Number(match[1]);
  return n >= 1 && n <= LIMITS_V3.relays ? `r${n}` : undefined;
}

/**
 * The relays Gladys may drive: `R1, R3:light`, or a range `R1-R8` (`R1-R8:light`) -> Map(code
 * -> kind). A bare number is a relay (`3` = `R3`, `1-8` = `R1-R8`); no kind = a switch. Every
 * other relay is read only. Wrong entries (a range backwards or past R32 included: nothing of
 * it is listed) are reported, not fatal. A relay listed again with another kind keeps its first
 * one (`R1-R8, R5:light`: R5 a switch) and is named in `conflicts`; the rest of the entry applies.
 */
export function parseRelays(raw) {
  const relays = new Map();
  const errors = [];
  const conflicts = new Set();
  for (const entry of String(raw ?? '').split(/[,;\n]+/)) {
    const text = entry.trim();
    if (text === '') continue;
    const match = /^r?(\d{1,2})(?:\s*-\s*r?(\d{1,2}))?\s*(?:[:=]\s*([a-z]+))?$/i.exec(text);
    const first = match ? relayCode(`r${match[1]}`) : undefined;
    const last = match ? relayCode(`r${match[2] ?? match[1]}`) : undefined;
    const kind = (match?.[3] ?? 'switch').toLowerCase();
    const from = Number(match?.[1]);
    const to = Number(match?.[2] ?? match?.[1]);
    if (!first || !last || to < from || !RELAY_KINDS.includes(kind)) {
      errors.push(text.slice(0, 20));
      continue;
    }
    for (let n = from; n <= to; n += 1) {
      // A relay listed twice with another kind keeps its first one, named in the status (the
      // rest of the entry applies: not "not understood").
      if (!relays.has(`r${n}`)) relays.set(`r${n}`, kind);
      else if (relays.get(`r${n}`) !== kind) conflicts.add(`r${n}`);
    }
  }
  return {
    relays,
    errors: errors.slice(0, 10),
    conflicts: [...conflicts].slice(0, 10).map((code) => ({ code, kind: relays.get(code) })),
  };
}

const RANGE = { r: LIMITS_V3.relays, d: LIMITS_V3.inputs };

/**
 * What the IPX has beyond its own 8 relays and 8 inputs (the status answers
 * 32 of each, wired or not): `R9-R16, D9-D24`.
 */
export function parseExtensions(raw) {
  const codes = new Set();
  const errors = [];
  for (const entry of String(raw ?? '').split(/[,;\n]+/)) {
    const text = entry.trim().toLowerCase().replace(/\s+/g, '');
    if (text === '') continue;
    const match = /^(r|d)(\d{1,2})(?:-(r|d)?(\d{1,2}))?$/.exec(text);
    const prefix = match?.[1];
    const first = Number(match?.[2]);
    const last = match?.[4] === undefined ? first : Number(match[4]);
    if (
      !match ||
      (match[3] !== undefined && match[3] !== prefix) ||
      first < 1 ||
      last < first ||
      last > RANGE[prefix]
    ) {
      errors.push(entry.trim().slice(0, 20));
      continue;
    }
    for (let n = first; n <= last; n += 1) {
      codes.add(`${prefix}${n}`);
    }
  }
  return { codes, errors: errors.slice(0, 10) };
}

const number = (value) =>
  value === undefined || value === null || value === '' ? NaN : Number(value);

const clamp = (value, { min, max }, fallback) =>
  Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;

export function normalizeConfig(raw = {}) {
  const address = parseAddress(raw?.host);
  const user = parseUser(raw?.username);
  const password = parsePassword(raw?.password);
  const relays = parseRelays(raw?.relays);
  const extensions = parseExtensions(raw?.extensions);
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const port = address.port ?? API.defaultPort;
  let credentialsError;
  if (user === null) credentialsError = 'user';
  else if (password === null) credentialsError = 'password';
  else if (password !== '' && user === '') credentialsError = 'passwordAlone';
  else if (user !== '' && password === '') credentialsError = 'userAlone';
  return {
    host: address.host ?? '',
    port,
    addressError: address.error,
    key: controllerKey(address.host, port),
    user: user ?? '',
    password: password ?? '',
    credentialsError,
    relays: relays.relays,
    relayErrors: relays.errors,
    relayConflicts: relays.conflicts,
    extensions: extensions.codes,
    extensionErrors: extensions.errors,
    // Set by src/hub.js: the address of an earlier slot (one IPX800, one lane of requests).
    duplicateOf: Number.isInteger(raw?.duplicate_of) ? raw.duplicate_of : undefined,
    pollInterval: clamp(number(raw?.poll_interval), POLL_INTERVAL, DEFAULTS.poll_interval),
    // The faster pace of the inputs, in ms; undefined (0 or less, empty, not a number) =
    // pollInterval: the Gladys form never sends an emptied number field, so 0 is the way back.
    inputsPollMs:
      number(raw?.inputs_poll_ms) > 0
        ? clamp(number(raw?.inputs_poll_ms), INPUTS_POLL_MS, undefined)
        : undefined,
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}

/**
 * Up to SLOTS IPX800 V3 in one integration (Gladys runs one instance of it).
 * The first one has the manifest keys `host`, `username`, `password`,
 * `relays`, `extensions`; the n-th one has them with `_<n>` (`host_2`...).
 * The port goes in the address (`192.168.1.51:8080`). The poll intervals and
 * the language are shared.
 */
export const SLOTS = 3;

const SLOT_KEYS = ['host', 'username', 'password', 'relays', 'extensions'];
const SHARED_KEYS = ['poll_interval', 'inputs_poll_ms', 'language'];

/** The configuration of one slot, in the shape of the first one (for normalizeConfig). */
export function slotConfig(raw, slot) {
  if (slot === 1) return raw ?? {};
  const out = {};
  for (const key of SLOT_KEYS) out[key] = raw?.[`${key}_${slot}`];
  for (const key of SHARED_KEYS) out[key] = raw?.[key];
  return out;
}

/**
 * The configuration of each slot; a slot whose address and port are those of an earlier slot
 * gets `duplicate_of`: it is not read nor driven (two lanes would hit one IPX800, and its
 * relays would answer to two devices).
 */
export function slotConfigs(raw, slots = SLOTS) {
  const seen = new Map();
  const out = new Map();
  for (let slot = 1; slot <= slots; slot += 1) {
    const config = slotConfig(raw, slot);
    const { key } = normalizeConfig(config);
    if (key && seen.has(key)) {
      out.set(slot, { ...config, duplicate_of: seen.get(key) });
    } else {
      if (key) seen.set(key, slot);
      out.set(slot, config);
    }
  }
  return out;
}

/** True when a slot after the first one has an address, a user or a password typed. */
export const slotTyped = (raw, slot) =>
  slot === 1 ||
  ['host', 'username', 'password'].some(
    (key) => String(raw?.[`${key}_${slot}`] ?? '').trim() !== '',
  );

/** True when the address is there and valid, and the credentials (none, or both) are valid. */
export const isComplete = (config) =>
  config.host !== '' && config.addressError === undefined && config.credentialsError === undefined;

/** The credentials as one text (the tag of a refusal); '' when none. */
export const credentialsOf = (config) =>
  config.user === '' ? '' : `${config.user}\u0000${config.password}`;

/** What a session depends on: a change starts again (and lifts refused credentials). */
export const sessionKey = (config) =>
  JSON.stringify([
    config.host,
    config.port,
    config.user,
    config.password,
    config.addressError,
    config.duplicateOf,
  ]);

/** The time between two rounds (ms): the poll interval, or the pace of the inputs when faster. */
export const roundInterval = (config) =>
  Math.min(config.pollInterval * 1000, config.inputsPollMs ?? Infinity);

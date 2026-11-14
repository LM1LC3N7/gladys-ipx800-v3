// -----------------------------------------------------------------------------
// Constants: the local HTTP API of the GCE IPX800 V3, the targets the
// integration knows, the manifest keys, the limits and the timings.
//
// IPX800 V3 (as amg0/ha_ipx800v3 uses it, MIT; checked against the Api-Deck
// V3 of cce66's tools, see TODO.md "V3 API against the sources"):
//   - `GET /globalstatus.xml`: every value in one flat XML answer: relays
//     `led0`..`led31` (0 / 1), digital inputs `btn0`..`btn31` (`up` / `dn`),
//     analog inputs `analog0`.. (raw 0-1023) and their sensor type
//     `anselect0`..; `GET /status.xml` is read instead when it is missing
//     (an older firmware, as cce66's tool reads it);
//   - `GET /preset.htm?set<N>=1|0` switches relay N (1 to 32) on / off: an
//     absolute write. `leds.cgi?led=<N-1>` (a toggle, or an impulse) is never
//     used: a toggle sent on a stale state would switch on a relay asked off.
// When the IPX800 protects its pages, every request carries HTTP Basic
// credentials (user and password): the header is built here and never
// logged, nor put in an error, a status or /data.
// -----------------------------------------------------------------------------

export const API = {
  defaultPort: 80,
  /** The status pages, in the order they are tried. */
  status: ['/globalstatus.xml', '/status.xml'],
  preset: '/preset.htm',
};

/** Kinds of targets (the type part of the external ids): frozen. */
export const KINDS = {
  RELAY: 'relay',
  INPUT: 'input',
  ANALOG: 'analog',
};

/** Feature keys (the last part of the feature external ids): frozen. */
export const FEATURES = {
  /** Relays: the key is the kind the user gave it (a new kind adds a feature). */
  READONLY: 'readonly',
  SWITCH: 'switch',
  LIGHT: 'light',
  STATE: 'state',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
};

/** What a relay declared in the configuration becomes. */
export const RELAY_KINDS = [FEATURES.SWITCH, FEATURES.LIGHT];

/**
 * The analog sensor types (`anselect<i>`) published, and how a raw value
 * (0-1023, 3.3 V / 1023 a step) becomes a measure, as ha_ipx800v3 converts
 * them (the GCE formulas). The type numbers 0-5 are also those of cce66's
 * Api-Deck. Others (0 raw, 1 voltage, 3 light, 7-12 X-400 CT, pH, ORP) are
 * not published in milestone 1 (see TODO.md).
 */
export const ANALOG_TYPES = new Map([
  // TC4012 temperature sensor.
  ['2', { feature: FEATURES.TEMPERATURE, convert: (raw) => raw * 0.323 - 50 }],
  // SHT-X3 temperature (TC5050).
  ['4', { feature: FEATURES.TEMPERATURE, convert: (raw) => (raw * 0.00323 - 1.63) / 0.0326 }],
  // SHT-X3 humidity (SH100), corrected for 15 °C as ha_ipx800v3 does (no temperature known).
  [
    '5',
    {
      feature: FEATURES.HUMIDITY,
      convert: (raw) => ((raw * 0.00323) / 3.3 - 0.1515) / 0.00636 / (1.0546 - 0.00216 * 15),
    },
  ],
  // TC100 temperature sensor.
  ['6', { feature: FEATURES.TEMPERATURE, convert: (raw) => (raw * 0.00323 - 0.25) / 0.028 }],
]);

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  ATTACH: 'attach_devices',
};

/**
 * The read pace (`inputs_poll_ms`, "Read every (milliseconds)", in ms; empty or 0 = the
 * default, or the seconds of `poll_interval` kept from before 0.2.2). One round reads the
 * whole status page (relays, inputs, analog inputs) in one request, one request at a time:
 * 1 s at least, for the small web server of the IPX800 V3.
 */
export const POLL_MS = { min: 1_000, max: 300_000, default: 10_000 };

/**
 * `poll_interval` (seconds), the field of 0.1.x and 0.2.x merged into `inputs_poll_ms` in
 * 0.2.2: no longer in the manifest, still read from the configuration Gladys kept, with the
 * bounds it had then (5 s to 300 s, both within POLL_MS).
 */
export const LEGACY_POLL_INTERVAL = { min: 5, max: 300, default: 10 };

/**
 * Sizes of the V3: 32 relays and 32 inputs in its answer (its own 8 of each,
 * the others with X-880 / X-24D extensions, wired or not); 16 analog inputs
 * (`analog0`..`analog15` in the `status.xml` of firmware 3.05.69, cce66),
 * all read: one becomes a device only with a published probe type.
 */
export const LIMITS_V3 = { relays: 32, inputs: 32, analogs: 16, own: 8 };

/** A measurement out of these ranges is not one (never published). */
export const RANGES = {
  temperature: { min: -40, max: 125 },
  humidity: { min: 0, max: 100 },
  /** A raw analog value: 0 (nothing wired) and 1023 (saturated, open input) are not read. */
  raw: { min: 1, max: 1022 },
};

export const LIMITS = {
  /** Gladys: 300 states per minute; a margin is kept. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** An answer is read up to this size, then dropped (globalstatus.xml: a few KB). */
  responseBytes: 64 * 1024,
  /** Elements of the XML answer read: more is not an IPX800 V3. */
  xmlElements: 1024,
  /** Non-protective commands waiting (a scene); protective ones are never refused for room. */
  commandQueue: 16,
  /** Protective commands kept in /data to send again. */
  guards: 128,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One request of the polling. */
  requestTimeout: 5 * SECOND,
  /** A round (the status page, and the other one when the first is missing) takes no longer than this. */
  roundBudget: 20 * SECOND,
  /** Failed rounds: 10 s, 30 s, 1, 2 then 5 min, never shorter than the interval. */
  backoff: [10 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  /** The controller asks to wait (429, 503): at least a minute. */
  busyPause: MINUTE,
  /** A pause is never longer than this, whatever /data holds. */
  pauseMax: HOUR,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** "Test the connection" reads at most this often; it answers within 25 s (Gladys waits 30 s). */
  testCooldown: 10 * SECOND,
  testBudget: 25 * SECOND,
  /**
   * Commands (Gladys waits 5 s for the ack): written by 3.5 s after the
   * click or refused unsent; the read back awaited until 4.3 s, after which
   * the command is "sent, without confirmation" and read again later.
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  /** A protective command not sent at once is tried again during this budget. */
  protectiveRetry: 250,
  protectiveRetryGap: 50,
  /** A protective write without answer for this long is cut when another one waits. */
  stuckProtective: SECOND,
  /** Between two requests to the IPX (after the previous connection is closed). */
  laneGap: 10,
  /** A request cut by a protective command is closed within this (socket destroyed). */
  cutWait: 500,
  /** Reads after a command: its effect, then a check. */
  followUps: [5 * SECOND, 20 * SECOND],
  /** A protective command contradicted by the reads is sent again this many times at most. */
  resendMax: 3,
  /** The configuration of Gladys not read: new tries 5 s, 15 s, then every minute. */
  configRetry: [5 * SECOND, 15 * SECOND, MINUTE],
  /** A click while the configuration is unread asks for it at once (2 s apart at most) and waits this long. */
  configAskGap: 2 * SECOND,
  configWait: 3 * SECOND,
  /** A read or a save of /data waited this long at most (a frozen disk holds nothing). */
  storeWait: 1_500,
  /**
   * Rounds faster than this (inputs_poll_ms under 5000): the time of the attempt goes to /data before a
   * read at most this often, a restart adds it to the wait (never sooner than the interval),
   * and the state after a round is written only when it changed (no disk write a second).
   */
  attemptSaveEvery: 5 * SECOND,
  /**
   * Rounds faster than attemptSaveEvery: after an answer, the IPX rests at least as long as
   * that request took, and at least this (a slow IPX is never kept busy all the time).
   */
  fastRest: 250,
  /**
   * Fast rounds: a switch-off contradicted by the reads is sent again at most this often (at
   * 1 s, its 3 resends would otherwise be spent within 3 s); at 5 s and more, one a read.
   */
  guardResendGap: 5 * SECOND,
  /** "Attach the devices": the second click within this. */
  attachConfirm: MINUTE,
};

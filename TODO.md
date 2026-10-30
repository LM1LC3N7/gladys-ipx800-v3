# TODO - IPX800 V3 v1

Handoff document: what is done, what was decided, what comes next. Keep it up
to date at the end of every milestone.

## Status

- [x] **Milestone 1** (2026-10-30): IPX800 V3 over its local HTTP interface
      (`globalstatus.xml`, or `status.xml` when it is missing; `preset.htm`
      for the relays), with the Basic credentials of its protected pages;
      relays (read only unless listed), digital inputs, analog inputs with a
      temperature or humidity probe; switching a listed relay off is
      protective (guards in `/data`); up to 3 IPX800 V3 (slots), each keeping
      its devices (address and port); "Test the connection", "Attach the
      devices"; fr/en docs. Built from gladys-ipx800 v0.1.3 (same author: the
      lane, the guards, the slots, `/data`, its reviews r1-r4 and the lessons
      of lots 17-19 kept), its V4 / V5 parts replaced by the V3 API. Tested
      against an in-memory IPX800 V3 on a virtual clock, and a real local
      HTTP server on a real clock (x20). Requested by cce66 (forum t/11448,
      reserved in t/10385 #436), who has the real boxes and will test.
- [x] **Review r1** (2026-10-30, xhigh): REFUSÉ, 1 bloquant (frozen /data),
      4 importants, 6 mineurs; fixed (see "Decisions after the review r1").
- [ ] **Review r2**.
- [ ] **cce66's test** on his IPX800 V3: the questions below; then "never
      tested with a real device" goes (README, docs, manifest; ask Louis).
- [ ] **Milestone 2**: counters (`count<n>`: lifetime counters, never 0 nor
      a drop published, an exit and a status signal on a reset), the other
      analog probes (raw, voltage, light, X-400 CT, pH, ORP: units to check),
      the names of the IPX (`ioname.xml`, as ha_ipx800v3 reads them), the
      push of the IPX (`protect/settings/push3.htm`) if polling is not enough.
- [ ] **Release**: review, `gi ci`, Release workflow, topic.

## V3 API against the sources (2026-10-30)

Sources: amg0/ha_ipx800v3 (MIT, commit 990503c, the reference ported);
cce66's `GCE_IPX800V3_Api-Deck v1.html` (MIT, commit e76f2b3: a user's tester,
not a GCE specification); Xavieto/pyipx800v3_async 0.4.0 (WTFPL, read only).
nohkumado/ipxbridge (GPL-3.0) and remialban/ipx800v3 (no licence) were not
read.

Confirmed by the reference and cce66's tool:

- `GET /preset.htm?set<N>=1|0` sets relay N (1 to 32) on / off (absolute);
  ha_ipx800v3 has it (`async_set_relay`), cce66's "Preset sortie" too, and
  pyipx800v3 uses it. Used here.
- `GET /leds.cgi?led=<N-1>` toggles relay N, or pulses it (Ta / Tb):
  ha_ipx800v3 uses it for on and off, cce66's "Set sortie" says so. **Not
  used**: a toggle sent on a stale state switches on a relay asked off.
- 32 relays and 32 inputs (ha_ipx800v3 reads `led0`-`led31`, `btn0`-`btn31`;
  cce66: "les 32 sorties", inputs 1 to 32).
- The analog sensor types 0 raw, 1 voltage, 2 TC4012, 3 SHT light, 4 SHT
  temperature, 5 SHT humidity (ha_ipx800v3's `anselect` cases; cce66's
  "Config analogique" list).

Not confirmed by two sources (the reference alone, or cce66 alone): in the
code with a fallback or a limit, and asked below.

- The status page: ha_ipx800v3 reads `globalstatus.xml`, cce66's tool
  `status.xml`. Both read here (`globalstatus.xml`, then `status.xml` on a
  404), same parser.
- The elements and their values: `led<n>` 0 / 1, `btn<n>` `dn` (on) / `up`,
  `analog<n>` raw, `anselect<n>` (ha_ipx800v3 only; cce66's tool does not
  show the answer). Anything else is unknown, never 0.
- The conversions of the analog types (ha_ipx800v3 only): 2 `x * 0.323 - 50`,
  4 `(x * 0.00323 - 1.63) / 0.0326`, 5 the GCE humidity formula at 15 °C, 6
  (TC100, not in cce66's list) `(x * 0.00323 - 0.25) / 0.028`.
- The number of analog inputs: cce66's tool 1 to 4; ha_ipx800v3 reads what
  the page holds. 4 here (A1-A4).
- HTTP Basic credentials (ha_ipx800v3 and pyipx800v3; not in cce66's tool),
  and what a wrong one answers (401 assumed, as both libraries do).
- The MAC address: in neither. The identity is the address and port.
- The "not ready" answer (ha_ipx800v3 e90a553, `api/client.py`: every
  `analog<n>` 0 and `dnsstatus` holding "pending", seen on a real V3): read
  here as a failed read (nothing published, no guard decided on it).
- Raw analog 0 = nothing wired, 1023 = an open input: from no source, a
  cautious assumption (no measurement published then); asked below.

**cce66's Api-Deck V3 inverts its "Preset sortie" and "Set sortie"**
(`GCE_IPX800V3_Api-Deck v1.html`, e76f2b3): the options are
`['1 - On','0 - Off']`, rendered as `<option value="${index}">`, and
`buildCmd` writes `set${num}=${state}` with that index: "1 - On" sends
`set1=0`, "0 - Off" sends `set1=1` (the M2M `Set{num}{state}` too). The
module follows ha_ipx800v3 and pyipx800v3 (`set<N>=1` on, `=0` off), held by
a test (`test/review-r1.test.js`, I4). A test with the tool would show the
reverse: never "fix" the writes from it (every switch-off and "turn
everything off" would switch on).

## Questions for cce66 (his IPX800 V3)

1. The answer of `http://<ipx>/globalstatus.xml` and of `/status.xml`
   (copy them, the user and password are not in them): which one exists on
   his firmware, which version (`<version>`)?
2. In that answer: `led0`..`led31` as 0 / 1? `btn0`..`btn31` as `up` /
   `dn` (and is `dn` "closed")? `analog0`..: how many, raw 0-1023?
   `anselect0`..: the probe types?
3. Is there a MAC address in one of these pages (or another page without a
   password: `/config.xml`?), so that a box replaced at the same address can
   be told apart?
4. With the protection on: does a wrong password answer 401 (or a login page
   with 200)? Does `preset.htm` need the password too?
5. **With URLs typed by hand in a browser** (not his Api-Deck, whose "Preset
   sortie" sends the index of its option: "1 - On" gives `set1=0`):
   `http://<ipx>/preset.htm?set1=1`, then `http://<ipx>/preset.htm?set1=0`,
   on a relay he can watch: does the first switch it on and the second off?
   And on a relay set in pulse mode (Ta / Tb): does `set1=1` start the pulse,
   or leave it on?
6. Inputs 9-32: are they those of an X-24D / X-880, or the virtual inputs
   his tool "simulates" (`leds.cgi?led=99+n`)?
7. His analog probes: which types, and do the temperatures in Gladys match
   the IPX page (TC4012, TC100, SHT)? An input with nothing wired: does it
   read 0, and an open one 1023?
8. Right after the IPX800 starts (power on): does `globalstatus.xml` answer
   every analog value 0 and `<dnsstatus>pending</dnsstatus>` for a while?

## Notes for the forum (reply to cce66, t/11448)

- Ask for the test of question 5 **with URLs typed by hand**, and say why:
  the "Preset sortie" and "Set sortie" of his Api-Deck V3 send the index of
  the option ("1 - On" sends `set1=0`): tested with it, the relay does the
  reverse. A friendly report for his tool, nothing to change in Gladys.
- Ask him not to list a relay set to pulse mode (a gate, a door strike)
  until question 5 is answered.

## Decisions after the review r1 (2026-10-30)

- **B1, frozen /data**: every read and save of `/data` is bounded
  (`TIMINGS.storeWait`, 1.5 s). A load past it is "unreadable" (the start goes
  on, owner unknown, switch-offs to the address typed); a save past it is a
  failed save (logged once, status not "Connected", text said), one save at a
  time (a save asked while one hangs is not stacked; the latest state goes
  once it ends). Rounds, the test button and switch-offs never wait longer.
- **I1, owner unknown** (no file with devices, `/data` never writable,
  unreadable, damaged): the switch-off of a listed relay goes to the address
  typed (the identity of a V3); switching on waits for "Attach the devices".
  When `/data` reads again, its owner and guards are taken and the verdict
  worked out again. "Attach" is made only when `/data` writes it (it must
  survive a restart); refused, said, otherwise.
- **I2**: the guards held in memory are carried into a new session of the
  same controller key (new credentials), whatever `/data` kept.
- **I3**: the "not ready" answer of ha_ipx800v3 e90a553 is a failed read
  (code `pending`): nothing published, no guard confirmed or lifted.
- **I4**: see "cce66's Api-Deck V3 inverts…" above; question 5 rewritten.
- **m1**: a slot with the controller key of an earlier slot is not read nor
  driven, its status says so (`slotConfigs`, as gladys-ipx800 7786d42).
- **m2**: ids of a slot this version does not have (`ipx4:`…) get a plain
  refusal (as gladys-ipx800 7786d42).
- **m3**: a damaged state file (bad JSON, too large) is written again by
  "Attach the devices" (two clicks, after a successful read); a `/data` that
  cannot be read right now (EIO, no answer) is never written over.
- **m4**: texts: "nothing was applied" after a 401 to a write that left;
  a click during a restart says the restart, not Gladys; the pulse-mode
  warning in the relays field; the hub status joined by " | " (Gladys shows
  one block), as gladys-ipx800 7786d42.
- **m6**: tests for P12, P19, I11 (`test/review-r1.test.js`).

## Decisions

- **Version 0.1.0, set by hand once** in `package.json`, `package-lock.json`,
  the manifest `version` and the `docker_image` tag; every later version
  comes from Actions > Release.
- **SDK 0.16.0** (the latest on npm on 2026-10-30, `^0.16.0`).
- **Own client, no dependency**: no maintained IPX800 V3 client on npm; the
  API details are ported from ha_ipx800v3 (MIT), credited in
  `THIRD_PARTY_NOTICES.md` (copied into the image with `LICENSE`).
- **Built from gladys-ipx800** (same author, Apache-2.0, reviewed four times
  and corrected after cce66's tests): its lane, guards, slots, `/data`,
  statuses and their tests kept; the V4 / V5 parts (pilot wire, X-THL, MAC,
  model choice, 0.1.2 migration) removed. A separate integration, as asked:
  another API, another store entry.
- **Scope of milestone 1**: relays, digital inputs, analog temperature and
  humidity. Counters are left for milestone 2 (lifetime counters need the
  guard of the energy modules); the other analog types too (their units are
  not in Gladys' lists, or not confirmed: the light probe reads 0-100, a
  percentage, while Gladys' light sensor is in lux).
- **Relays read only by default** (lesson of Velbus / Qbus and gladys-ipx800):
  a relay becomes a switch or a light only when the user lists it; the
  feature key is its kind (`readonly`, `switch`, `light`), a new kind adds a
  feature and keeps the old one. Commands are checked against the list of
  now, whatever feature they come from. Feature name "State (read only)" /
  "État (lecture seule)" (gladys-ipx800 r1 I1: right in both states).
- **Absolute writes only**: `preset.htm?set<N>=0|1`, never `leds.cgi`.
- **The only protective command**: switching a listed relay off. Never refused
  by a pause, refused credentials, the queue, a read or a command in
  progress; it cuts the request in flight (a read cut is no failure), cancels
  the commands of the same relay still waiting (a switch-on clicked while it
  is being sent is refused), is tried again for 250 ms, then kept as a guard
  in `/data` and sent again as soon as the lane is free and by the reads that
  contradict it (3 times at most, counted when sent: one that never left is
  never given up). A guard is lifted by a later command on the relay that
  left (not by a 4xx / 429 / 5xx answer), another switch-off, the relay
  leaving the list, or, once confirmed, the relay read on twice in a row;
  never by the time.
- **Refusals of a switch-off**: configuration incomplete (address missing or
  invalid, credentials invalid), relay not listed, value not 0 / 1, relay
  unknown (its element not in the last answer), another IPX800 or not known
  for sure (`/data` lost with devices; `/data` unreadable lets it go to the
  address typed).
- **One request at a time**: priorities clicked switch-off > guards and
  their read backs > commands > read backs > polling; the next connection
  opens only once the previous one is closed.
- **Commands**: written within 3.5 s or refused "nothing was sent"; a read
  back that left after the write confirms within 4.3 s; a different value is
  "not applied yet"; no answer is "sent, without confirmation"; reads 5 s
  and 20 s later.
- **Reads**: one request a round (`globalstatus.xml`, the other page on a
  404, remembered). The targets come from the configuration (R1-R8, D1-D8,
  A1-A4, the extensions, the listed relays); a code whose element is not in
  the answer is not on this IPX800 (no device, "declared but not found"); an
  element there but unreadable has no value. XML read with one bounded
  linear pattern (64 KB, 1024 elements), an element given twice is unknown.
- **Analog values**: a raw value 1-1022 only (0: nothing wired, 1023: an open
  input), converted, rounded to 0.1, within -40..125 °C or 0..100 %; a type
  not published gives no device and is named in the status (type 0, the
  default of an unused input, is not).
- **Credentials**: user and password both or neither (one alone is refused
  in the status); printable ASCII, 64 characters at most, no ":" in the
  user; sent as a Basic header on every request; a 401 / 403 stops the reads
  (a salted 8-bit tag in `/data`) until they change or the test button
  succeeds; never in a log, an error, a status or `/data`.
- **Identity**: the owner of a slot's devices is its controller key (a hash
  of address and port; no MAC in the V3 API as far as the sources go). A
  slot without devices takes the IPX800 read; another address: nothing sent,
  guards dropped, Discover empty, status; "Attach the devices" (two clicks
  within a minute) binds them to the address read. Known limit: another V3
  at the same address and port is not told apart (in the docs).
- **Several IPX800 V3**: up to 3 slots (`host_n`, `username_n`,
  `password_n`, `relays_n`, `extensions_n`), port in the address; poll
  interval and language shared; one state publisher for the 300 states a
  minute.
- **Pace**: one round per interval (10 s, 5 to 300), the time of the attempt
  in `/data` before the read; failures 10 s, 30 s, 1, 2, 5 min, at least a
  minute on 429 / 503, the pause in `/data`.
- **Units**: °C and % only (core list). Category `lighting` only.
- **Not in the manifest**: `keywords` and `countries` (need Gladys 5.3.0).

## Next patch (review r2, a0c3ded)

- m1: `T.notAttached` still says "none of their commands is sent / state lost" with an unknown owner and writable /data (Offs do go out) and on a fresh install before the first read; the status starts with "Connected…" when /data cannot be written.
- m2: ask cce66 (Q8) whether `dnsstatus` stays "pending" in normal use without Internet; if so the all-zero rejection would block every read. Consider also requiring every relay at 0. Mutant N8 survives.
- m3: tests for N18 (held Off lost when /data reads again), N10 (Rattacher marked done when its save failed), N15 (duplicate slot), N16 (TypeError on `ipx4:`).
- m4: P4 and P5 are equivalent belts (proved by execution); keep them with a comment.

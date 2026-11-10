# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.2.0] - 2026-11-10

### Added

- After cce66's test on his IPX800 V3 (firmware 3.05.69, forum t/11448):
  "Read the inputs every (milliseconds)", to see an input change sooner
  (1000 ms at least; 0: the read interval, as Gladys keeps a number field
  that is emptied); one request at a time, the whole status page each time,
  a rest after each answer at least as long as it took, and `/data` written
  only when something changed at that pace.
- A range of relays to drive: `R1-R8` (`R1-R8:light`). A range typed in
  0.1.1 was refused there: after the update it lists its relays (those
  already created stay read only until "Update" in Discover). A relay listed
  twice with another kind keeps its first one, and the status says it
  ("listed twice"); the rest of the entry applies.
- The 16 analog inputs of the IPX800 V3 (A1 to A16), each a device only with
  a published probe type.

### Changed

- At the inputs pace (under 5 s), a switch-off the reads do not show is
  sent again 5 s apart at least (still 3 times at most); at 5 s and more,
  one a read as before.

- New devices are named after their code: `IPX800V3-R1`, `IPX800V3-D1`,
  `IPX800V3-A1` (`IPX800V3-2-R1` for the IPX800 #2); devices already
  created keep their name.

## [0.1.1] - 2026-10-30

### Added

- First version: the GCE IPX800 V3 over its local HTTP interface
  (`globalstatus.xml`, or `status.xml`; `preset.htm` for the relays), with
  the user and password of its protected pages when it has some.
- Relays (read only unless listed in "Relays Gladys may drive", as a switch
  or a light), digital inputs, analog inputs with a TC4012, TC100 or SHT
  temperature probe or an SHT humidity probe; extensions up to R32 and D32.
- Switching a listed relay off goes first: during a pause, with refused
  credentials, the queue full, before the first read; kept in `/data` and
  sent again until the reads show it.
- Up to three IPX800 V3, each keeping its devices (by address and port);
  "Attach the devices" (two clicks) after a change of address.
- "Test the connection"; guides in English and French.
- A `/data` that does not answer (a frozen disk) is waited for 1.5 s at most:
  the reads, the test button and the switch-offs go on, the status says it.
- When `/data` does not tell which IPX800 the devices belong to (deleted,
  never writable, unreadable, damaged), switching a listed relay off goes to
  the address typed; "Attach the devices" also writes a damaged state file
  again.
- The "not ready" answer of a V3 (every analog 0, `dnsstatus` pending) is not
  a reading; the same address in two slots is refused; ids of an unknown slot
  get a plain refusal.

[Unreleased]: https://github.com/LM1LC3N7/gladys-ipx800-v3/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/LM1LC3N7/gladys-ipx800-v3/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/LM1LC3N7/gladys-ipx800-v3/releases/tag/v0.1.1

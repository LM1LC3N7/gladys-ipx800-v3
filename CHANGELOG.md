# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

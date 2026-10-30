# gladys-ipx800-v3

[Gladys Assistant](https://gladysassistant.com) integration for the **GCE
Electronics IPX800 V3** (up to three in one installation), through its local
HTTP interface: relays (read only unless you list them), digital inputs,
analog temperature and humidity probes.

- Relays: read only unless listed in "Relays Gladys may drive"; switching a
  listed relay off goes before anything else (its limits in the guide).
- The password (when the IPX800 protects its pages) is never written in the
  logs nor in `/data`.
- Each IPX800 keeps its devices (known by its address and port): another
  address never gets their commands.

Never tested with a real device. Not affiliated with GCE Electronics. For an
IPX800 V4 or V5, see [gladys-ipx800](https://github.com/LM1LC3N7/gladys-ipx800).

User guide: [English](docs/en.md) · [Français](docs/fr.md).

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
```

See `CLAUDE.md` (architecture, rules) and `TODO.md` (status, decisions,
questions). Licensed under the Apache License 2.0; ported logic credited in
`THIRD_PARTY_NOTICES.md`.

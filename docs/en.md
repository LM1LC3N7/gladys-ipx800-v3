# IPX800 V3 for Gladys

Brings **up to three GCE Electronics IPX800 V3** into Gladys through their
local HTTP interface: their relays, their inputs and their analog inputs
wired to a temperature or humidity probe.

> Never tested with a real device: written from the open-source Home
> Assistant integration ha_ipx800v3 and the test tools cce66 published on
> the forum. Tell us what you see on yours. Not affiliated with GCE
> Electronics.

For an IPX800 V4 or V5, use the **IPX800** integration (another API).

## Installation

1. In Gladys, Integrations > IPX800 V3: enter the address of the IPX800
   (e.g. `192.168.1.50`, with `:port` only if its web server is not on 80;
   give it a fixed address in your router).
2. If the IPX800 protects its pages with a user and a password (Network >
   Security), enter both; leave them empty otherwise.
3. On the same page, list in "Relays Gladys may drive" the relays Gladys
   must drive, and those only (e.g. `R1, R2`; see "Relays" below: never a
   pump, a ventilation, a door strike…). If the IPX800 has extensions (X-880,
   X-24D), list them in "Extensions", e.g. `R9-R16, D9-D24`. Then save.
4. "Test the connection" reads the IPX800 at once (once an interval has
   passed since the last read) and shows what it found.
5. In Discover, create the devices you want. A listed relay comes as a
   switch (or a light); the others come **read only** ("State (read
   only)"): Gladys shows their state, nothing can switch them.

A relay listed **after** its creation stays read only until you click
**"Update"** on it in Discover: it then gets its switch (or light), next to
its "State (read only)", which stays. The status of the integration says
how many relays are read only while none is listed, and which listed relays
still wait for "Update".

The password goes with every request, over plain http (as the IPX800's own
pages do): anyone who can watch your local network can read it. It is kept
by Gladys in its database, never shown again, sent only to the IPX800, and
never written in the logs nor in the files of the integration.

## What you get

| On the IPX800                                               | In Gladys                                     | Code (in the name) |
| ----------------------------------------------------------- | --------------------------------------------- | ------------------ |
| Relay 1 to 8 (up to 32)                                     | read only, or a switch / light if you list it | `R3`               |
| Input 1 to 8 (up to 32)                                     | a binary input (read only)                    | `D3`               |
| Analog input 1 to 4, TC4012, TC100 or SHT temperature probe | temperature (°C)                              | `A1`               |
| Analog input 1 to 4, SHT humidity probe                     | humidity (%)                                  | `A2`               |

The IPX800 V3 answers 32 relays and 32 inputs, wired or not: the
integration shows its 8 relays and 8 inputs, and what you list in
"Extensions". An input is "on" when the IPX800 reads it closed (`dn`).

An analog input is published only when the probe type chosen on the IPX800
is one of those in the table; its value is computed with the GCE formulas
(those of the Home Assistant integration). The humidity of an SHT probe is
corrected for 15 °C (the integration does not know what temperature the
probe sees): at 25 °C it reads about 2 % too high. The other types (raw,
voltage, light, X-400 CT, pH, ORP) are not in this version: the status names
the inputs concerned. A raw value of 0 (nothing wired) or 1023 (open input)
is no measurement.

The IPX800 is read every 10 seconds by default (5 s at least), through its
page `globalstatus.xml`, or `status.xml` when that one is missing. A value
the IPX800 does not give (missing, a text, out of range) is not published:
never as 0.

## Several IPX800 V3

Keep the first one in the fields at the top, and put the other one in
**"IPX800 #2"** (address with `:port` if needed, user and password, its
relays Gladys may drive, its extensions), a third one in "IPX800 #3". Each
has its own devices in Discover ("IPX800 #2 · Relay 1 (R1)"), its own list
of relays and its own line in the status. The poll interval and the
language are shared.

**Do not change the address of a slot to try another IPX800**: the devices
already created stay with their slot. Add the other one as #2.

## Each IPX800 keeps its devices

A device created for one IPX800 never drives an IPX800 at another address
(or port). The integration keeps, in `/data`, which IPX800 the devices of
each slot belong to: by **its address and port** (kept as a hash), as the
V3 API gives no MAC address the integration knows of.

If the address or the port of a slot with devices changes:

- no command goes to the new address, not even a switch-off;
- the switch-offs kept for the old one are dropped;
- no value read is published onto these devices;
- Discover is empty for that slot;
- the status says so.

Put the old address back then. If it is **the same IPX800 at a new
address**, click "Attach the devices" **twice** (within a minute), choosing
the slot: its devices then drive the IPX800 read at this address, with the
slot's list of relays. A slot without any created device simply takes the
IPX800 it reads. If the state in `/data` is lost while devices exist,
nothing is sent to them until they are attached (two clicks).

Limit: another IPX800 V3 put **at the same address and port** is not told
apart from the first one.

## Relays: read only but those you list

A relay you do not list is **read only**. To drive one from Gladys, list it
in "Relays Gladys may drive", e.g. `R1, R3:light` (`:light` makes it a
light, a switch otherwise), preferably before creating it in Discover;
already created, click "Update" on it in Discover. A switch or a light obeys
every "turn everything off" of Google, Alexa, the MCP and the scenes: never
list a pump, a freezer, a ventilation, a heating, a door strike nor a valve.
A relay removed from the list is read only again at once: its commands are
refused, and a switch-off the integration still held for it is dropped (in
memory and in `/data`, after a restart too). Its switch stays on the device
in Gladys (without effect): Gladys does not delete a single feature; only
deleting the device, then creating it again, removes it, with its history.

A relay is written through `preset.htm` (on or off, an absolute value),
never by a toggle. A relay set to pulse mode on the IPX800 (Ta / Tb delays)
was not tried: do not list it until this is checked.

## Switching off a listed relay

Switching off a listed relay goes before anything else: during a pause after
failed reads, with a refused user or password (it is tried anyway), with
the queue of commands full, and before the first read after a restart.
Clicked, it cuts any request in flight (a read, a read back, a command, a
resend), unless it is another switch-off clicked just before; a switch-off
without answer for 1 s is cut by the next one.

It is refused only when:

- the address is missing or not valid, or the user and the password are not
  valid (one without the other, say);
- the relay is not listed;
- the value is neither 0 nor 1;
- the relay is not known (its number is not in the last answer of the
  IPX800);
- the IPX800 is not the one of the device, or nothing tells (see "Each
  IPX800 keeps its devices"; when `/data` cannot be read, it goes to the
  address typed).

Clicked before the configuration is read from Gladys (the password is kept
there only, never in `/data`), it asks Gladys for it at once and waits 3 s;
if it has not come, it is kept in memory and sent as soon as the
configuration is read (read again every 5 s while a switch-off waits),
before anything goes to Gladys; if the relay turns out unknown or not
listed, the status says so. A switch-off kept in `/data` leaves at start the
same way, without waiting for Gladys. When the IPX800 does not take it
within 3.5 s (no connection), it is kept and sent again as soon as the
IPX800 is free, before the read backs, by the next reads that show the
relay on, and after a restart; a switch-off that never left is never given
up (only a send counts as a try). A resend cut by a click before it left
goes again right behind that click.

A switch-off the reads do not show is sent again, 3 times at most (three
sends that left); then the status says so (check on site). It stays held
until a newer command on that relay leaves (your click), another
switch-off, the relay leaving the list, or, once applied, the relay read on
twice in a row (changed on the IPX800 itself, by its scenarios or its page):
never by the time. What was asked before a switch-off on the same relay and
not sent yet is cancelled; a switch-on clicked while it is being sent is
refused. A switch-on the integration sent before the switch-off and left
without an answer (cut by the switch-off, say), if the IPX800 applies it
anyway within 5 s of its leaving, is no change on the IPX800: the switch-off
is sent again.

## Commands

A command is written within 3.5 s of the click or refused with "nothing was
sent". It is then read back on the IPX800: the value asked is a success;
another value is "not applied yet"; no answer in time gives "sent, without
confirmation". Two reads follow, 5 s and 20 s later. The commands of a scene
are written one after the other, then read back once. One request at a time
goes to the IPX800.

## Pauses and refusals

A failed read pauses 10 s, 30 s, 1 min, 2 min then 5 min (a minute at least
when the IPX800 answers 429 or 503), the pause kept across restarts;
switching a relay on is refused until the pause ends. A user or password
refused by the IPX800 (401, 403), or asked for while none is typed, stops
the reads until you change them or "Test the connection" succeeds. An
address that answers neither `globalstatus.xml` nor `status.xml` (404) is
likely no IPX800 V3: the status says so. While an IPX800 does not answer (or
refuses the user), its devices leave Discover; a Scan does not bring them
back. They come back with the first successful read.

## Limits

- Relays, inputs and analog inputs (temperature, humidity) only; counters,
  other analog probes, schedules and virtual inputs are not in this
  version.
- Three IPX800 V3 at most per integration.
- The IPX800 is known by its address and port (see above).
- http only (the IPX800 answers over http on the local network).

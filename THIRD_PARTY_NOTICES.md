# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below. The ported parts were rewritten
in JavaScript; they are changed from the original (another language, another
structure, only what this integration needs). None of the original code is
copied as is.

## ha_ipx800v3

- Project: [amg0/ha_ipx800v3](https://github.com/amg0/ha_ipx800v3)
  (commit 990503c, 2026-10-26), the Home Assistant integration "My IPX800
  V3", by amg0, MIT licence.
- What is ported (in `src/constants.js`, `src/ipx/model.js` and
  `src/ipx/client.js`): the status page `globalstatus.xml` and its elements
  `led<n>` (relays, 0 / 1), `btn<n>` (inputs, `dn` = on), `analog<n>` and
  `anselect<n>`; the conversion of the raw analog value of the sensor types
  2 (TC4012), 4 (SHT temperature), 5 (SHT humidity, at 15 °C) and 6 (TC100);
  `preset.htm?set<n>=0|1` to switch relay n; HTTP Basic credentials on every
  request.
- Changes: rewritten in JavaScript for a Gladys external integration; absolute
  writes only (`preset.htm`, never the `leds.cgi` toggle the original uses);
  one request at a time with priorities; bounded answers read as untrusted
  data; values out of range or unreadable never published; no retry loop on
  writes; the credentials never in an error nor a log.

### MIT licence of ha_ipx800v3

```
MIT License

Copyright (c) 2026  amg0 @amg0

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Sources read, nothing taken

- cce66's tools (MIT, a user's testers, not a GCE specification):
  `GCE_IPX800V3_Api-Deck v1.html` of
  [Utilitaires_IPX800_X-Pool_Ecodevices_X-Display-V2_ScanDevice_Broker-Monitor_Modbus2Mqtt_Hub](https://github.com/cce66/Utilitaires_IPX800_X-Pool_Ecodevices_X-Display-V2_ScanDevice_Broker-Monitor_Modbus2Mqtt_Hub)
  (commit e76f2b3), read to check the API (see `TODO.md`); no code taken.
- [Xavieto/pyipx800v3_async](https://github.com/Xavieto/pyipx800v3_async)
  (WTFPL) was read to compare, nothing copied.
- Not read nor used: projects under the GPL or without a licence.

## Code of the same author

`src/` starts from [gladys-ipx800](https://github.com/LM1LC3N7/gladys-ipx800)
(Apache-2.0, same author): the lane of requests, the guards of the
protective commands, the slots, `/data`. `test/kit/` copies parts of the
shared test kit of the same author (Apache-2.0); it is not in the image.

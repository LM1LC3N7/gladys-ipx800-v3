// -----------------------------------------------------------------------------
// The status page of a fake IPX800 V3 (`globalstatus.xml` / `status.xml`), as
// ha_ipx800v3 reads it: a flat `<response>` with `led0`..`led31` (0 / 1),
// `btn0`..`btn31` (up / dn), `analog0`..`analog3` (raw 0-1023) and
// `anselect0`..`anselect3` (the sensor types), plus a few other elements.
// -----------------------------------------------------------------------------

/** A fresh state: everything off, inputs open, A1 a TC4012 at about 21.4 °C, A2 an SHT humidity. */
export function v3State() {
  return {
    led: Array(32).fill(0),
    btn: Array(32).fill('up'),
    analog: [222, 512, 0, 0],
    anselect: ['2', '5', '0', '0'],
  };
}

/** The XML of a state (`extra`: more elements, as text). */
export function v3Xml(state, extra = '') {
  const parts = ['<?xml version="1.0" encoding="iso-8859-1"?>', '<response>'];
  // An element whose value is undefined is left out (an IPX800 with fewer outputs).
  for (let i = 0; i < 32; i += 1) {
    if (state.led[i] !== undefined) parts.push(`<led${i}>${state.led[i]}</led${i}>`);
  }
  for (let i = 0; i < 32; i += 1) {
    if (state.btn[i] !== undefined) parts.push(`<btn${i}>${state.btn[i]}</btn${i}>`);
  }
  for (let i = 0; i < state.analog.length; i += 1) {
    parts.push(`<analog${i}>${state.analog[i]}</analog${i}>`);
    parts.push(`<anselect${i}>${state.anselect[i]}</anselect${i}>`);
  }
  parts.push('<count0>0</count0><count1>0</count1><count2>0</count2>');
  parts.push('<version>3.05.62</version><dnsstatus>ok</dnsstatus>');
  parts.push(extra);
  parts.push('</response>');
  return parts.join('\n');
}

/** Applies a `preset.htm` query to a state: true when it was a valid write. */
export function applyPreset(state, query) {
  const entries = [...query];
  if (entries.length !== 1) return false;
  const [name, value] = entries[0];
  const m = /^set(\d{1,2})$/.exec(name);
  if (!m || !['0', '1'].includes(value)) return false;
  const n = Number(m[1]);
  if (n < 1 || n > 32) return false;
  state.led[n - 1] = Number(value);
  return true;
}

/** The Basic header of credentials. */
export const basic = (user, password) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

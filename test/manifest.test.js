// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS, INPUTS_POLL_MS, POLL_INTERVAL } from '../src/constants.js';

/** The rule of the core for supported_options, when its clone is there (dev VM). */
const CORE_NORMALIZE = '/home/claude/code/Gladys/server/utils/normalizeSupportedOptions.js';
const normalizeSupportedOptions = existsSync(CORE_NORMALIZE)
  ? createRequire(import.meta.url)(CORE_NORMALIZE).normalizeSupportedOptions
  : undefined;

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics, the same version everywhere (semver, never pinned), no keywords nor countries yet', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-ipx800-v3:${manifest.version}`);
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.match(
    pkg.dependencies['@gladysassistant/integration-sdk'],
    /^\^/,
    'the SDK is never pinned',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['lighting']);
  assert.equal(manifest.keywords, undefined, 'keywords need gladys_version >= 5.3.0');
  assert.equal(manifest.countries, undefined, 'countries need gladys_version >= 5.3.0');
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    const flat = docs.replace(/\n>?\s*/g, ' ');
    assert.match(flat, /not affiliated with GCE|sans lien avec GCE/i);
    assert.match(
      flat,
      lang === 'en' ? /never tested with a real device/i : /jamais testé avec un vrai appareil/i,
    );
    assert.match(flat, /read only|lecture seule/i);
  }
  for (const file of [
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'docs/en.md',
    'docs/fr.md',
  ]) {
    assert.doesNotMatch(read(file), /encrypt|chiffr|hach/i, `${file}: nothing is encrypted`);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /encrypt|chiffr|hach/i);
  assert.match(read('TODO.md'), /## Decisions/);
  assert.match(read('TODO.md'), /0\.1\.0/);
  assert.match(read('CHANGELOG.md'), /## \[Unreleased\]/);
});

test('the licenses ship with the image; LICENSE is the standard text, without a name', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.doesNotMatch(license, /Louis|lmilcent|LM1LC3N7|Milcent/i);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /amg0\/ha_ipx800v3/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
  assert.doesNotMatch(notices, /ipxbridge|remialban/, 'nothing of the GPL / unlicensed projects');
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  assert.ok(existsSync(new URL('../cover.png', import.meta.url)));
  const png = readFileSync(new URL('../cover.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 534);
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
  }
});

test('the configuration matches the code; the password a secret without default', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const key of Object.keys(fields)) {
    assert.doesNotMatch(key, /^gladys_/i, 'a gladys_ key is never received');
  }
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.password.default, undefined, 'no default for a secret');
  assert.equal(fields.username.type, 'string');
  assert.equal(fields.username.required, false);
  assert.equal(fields.host.required, true);
  assert.match(fields.relays.description.en, /never list a pump/);
  assert.match(fields.relays.description.fr, /jamais une pompe/);
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max, fields.poll_interval.default],
    [POLL_INTERVAL.min, POLL_INTERVAL.max, POLL_INTERVAL.default],
  );
  assert.deepEqual(
    [fields.inputs_poll_ms.min, fields.inputs_poll_ms.max, fields.inputs_poll_ms.default],
    [INPUTS_POLL_MS.min, INPUTS_POLL_MS.max, undefined],
    'empty by default: the poll interval',
  );
  assert.equal(fields.inputs_poll_ms.required, false);
  for (const key of ['relays', 'relays_2', 'relays_3']) {
    assert.match(fields[key].description.en, /R1-R8/, key);
    assert.match(fields[key].description.fr, /R1-R8/, key);
  }
  for (const field of manifest.config_schema) {
    if (field.placeholder !== undefined)
      assert.equal(typeof field.placeholder, 'object', field.key);
    for (const option of field.options ?? []) {
      assert.equal(typeof option.value, 'string');
      for (const lang of ['en', 'fr']) assert.equal(typeof option.label[lang], 'string');
    }
  }
  const intro = fields.intro;
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(
      intro.description[lang],
      /Never tested with a real device|Jamais testé avec un vrai appareil/,
    );
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('the published features: no supported options, the core rule held; units from the core list only', async () => {
  const { buildDevice } = await import('../src/devices.js');
  const { createFakeGladys } = await import('@gladysassistant/integration-sdk/testing');
  const gladys = createFakeGladys({ selector: 'ipx' });
  const units = {
    'temperature-sensor': ['celsius'],
    'humidity-sensor': ['percent'],
  };
  for (const target of [
    { code: 'r1', kind: 'relay', n: 1 },
    { code: 'd1', kind: 'input', n: 1 },
    { code: 'a1', kind: 'analog', n: 1, sensor: 'temperature' },
    { code: 'a2', kind: 'analog', n: 2, sensor: 'humidity' },
  ]) {
    for (const relayKind of [undefined, 'switch', 'light']) {
      const device = buildDevice(gladys, target, { language: 'fr', relayKind });
      assert.ok(device.features.length > 0);
      for (const f of device.features) {
        if (f.unit !== undefined)
          assert.ok(units[f.category]?.includes(f.unit), `${f.category} ${f.unit}`);
        assert.equal(f.supported_options, undefined, 'none published');
        for (const o of f.supported_options ?? []) {
          assert.equal(typeof o.label, 'string');
          assert.equal(o.label, o.label.trim());
          if (normalizeSupportedOptions)
            assert.deepEqual(normalizeSupportedOptions([o], { allowStringValues: true }), [o]);
        }
        if (f.category === 'switch' || f.category === 'light') {
          assert.equal(
            f.read_only,
            relayKind === undefined,
            `a ${f.category} is commandable only when declared`,
          );
          assert.equal(f.type, 'binary');
        }
        if (target.kind !== 'relay') assert.equal(f.read_only, true);
      }
    }
  }
  const none = buildDevice(gladys, { code: 'a3', kind: 'analog', n: 3 }, { language: 'fr' });
  assert.deepEqual(none.features, [], 'an analog input of a type not published: no feature');
});

test('the slots of the other IPX800: every key of slotConfig in the manifest, the passwords secret', async () => {
  const { SLOTS, slotConfig } = await import('../src/config.js');
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (let slot = 2; slot <= SLOTS; slot += 1) {
    const raw = Object.fromEntries(Object.keys(fields).map((key) => [key, key]));
    for (const [name, from] of Object.entries(slotConfig(raw, slot))) {
      assert.ok(fields[from], `${name} of slot ${slot} (${from}) not in the manifest`);
    }
    assert.equal(fields[`password_${slot}`].type, 'secret');
    assert.equal(fields[`password_${slot}`].default, undefined);
    assert.equal(fields[`host_${slot}`].required, false);
    assert.match(fields[`relays_${slot}`].description.en, /never list a pump/);
  }
  const attach = manifest.actions.find((a) => a.key === ACTIONS.ATTACH);
  assert.deepEqual(
    attach.fields[0].options.map((o) => o.value),
    Array.from({ length: SLOTS }, (_, i) => String(i + 1)),
  );
});

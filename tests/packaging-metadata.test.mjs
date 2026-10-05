import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const tauriConf = JSON.parse(
  await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
);

test('Microsoft Store Win32 packaging metadata meets certification requirements', () => {
  // Product name must match Partner Center registered app name
  assert.equal(tauriConf.productName, 'Verseglade');

  // Publisher name must explicitly match Partner Center publisher ("Hemanth Vasi")
  // rather than defaulting to identifier prefix ("hemanth")
  assert.equal(
    tauriConf.bundle?.publisher,
    'Hemanth Vasi',
    'bundle.publisher must be explicitly set to "Hemanth Vasi" to match Partner Center'
  );

  // Copyright should be configured
  assert.ok(
    tauriConf.bundle?.copyright?.includes('Hemanth Vasi'),
    'bundle.copyright must reference Hemanth Vasi'
  );

  // NSIS installer mode must be perMachine so that ARP registry keys are written to HKLM
  // where Microsoft Store automated validation (WACK / store runner) verifies them
  assert.equal(
    tauriConf.bundle?.windows?.nsis?.installMode,
    'perMachine',
    'bundle.windows.nsis.installMode must be "perMachine" for HKLM Add/Remove Programs detection'
  );

  // NSIS must not display interactive language selector which would block silent /S install
  assert.equal(
    tauriConf.bundle?.windows?.nsis?.displayLanguageSelector,
    false,
    'displayLanguageSelector must be false to support unattended silent /S installation'
  );

  // NSIS installer hooks must be configured to enforce explicit ARP registry entries
  assert.equal(
    tauriConf.bundle?.windows?.nsis?.installerHooks,
    'windows/nsis-hooks.nsh',
    'installerHooks must point to windows/nsis-hooks.nsh'
  );
});

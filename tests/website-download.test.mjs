import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = await readFile(new URL('../website/script.js', import.meta.url), 'utf8');

function runWebsite(platform, userAgent = '') {
  const ids = [
    '#year', '#platform-select', '#download-platform-name', '#download-architecture',
    '#download-description', '#platform-icon', '#download-link', '#download-label',
    '#download-unavailable', '#download-status',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, {
    value: '',
    textContent: '',
    className: '',
    hidden: false,
    attributes: {},
    addEventListener(type, handler) { this[`on${type}`] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  }]));
  const context = {
    document: { querySelector: selector => elements[selector] ?? null },
    navigator: { platform, userAgent },
    Date,
  };
  vm.runInNewContext(script, context);
  return elements;
}

test('the detected desktop OS gets exactly its relevant installer', () => {
  const cases = [
    ['MacIntel', '', 'macos', 'Verseglade-macOS-aarch64.dmg'],
    ['Win32', 'Windows NT 10.0; Win64; x64', 'windows', 'Verseglade-Windows-x64-setup.exe'],
    ['Linux x86_64', 'X11; Linux x86_64', 'linux', 'Verseglade-Linux-x64.AppImage'],
  ];
  for (const [platform, userAgent, expected, filename] of cases) {
    const elements = runWebsite(platform, userAgent);
    assert.equal(elements['#download-platform-name'].textContent.toLowerCase(), expected);
    assert.equal(elements['#download-link'].hidden, false);
    assert.match(elements['#download-link'].href, new RegExp(`${filename.replaceAll('.', '\\.')}$`));
    assert.equal(elements['#download-unavailable'].hidden, true);
  }
});

test('unknown and mobile systems get no default installer and can choose manually', () => {
  for (const [platform, userAgent] of [['', ''], ['Linux armv8l', 'Android 14']]) {
    const elements = runWebsite(platform, userAgent);
    assert.equal(elements['#download-link'].hidden, true);
    assert.equal(elements['#download-unavailable'].hidden, false);
    assert.equal(elements['#download-link'].attributes.href, undefined);
    elements['#platform-select'].value = 'windows';
    elements['#platform-select'].onchange();
    assert.equal(elements['#download-platform-name'].textContent, 'Windows');
    assert.equal(elements['#download-link'].hidden, false);
    assert.match(elements['#download-link'].href, /Verseglade-Windows-x64-setup\.exe$/);
  }
});

test('visitors can switch back to the detected operating system', () => {
  const elements = runWebsite('MacIntel');
  elements['#platform-select'].value = 'windows';
  elements['#platform-select'].onchange();
  assert.equal(elements['#download-platform-name'].textContent, 'Windows');
  elements['#platform-select'].value = 'auto';
  elements['#platform-select'].onchange();
  assert.equal(elements['#download-platform-name'].textContent, 'macOS');
});

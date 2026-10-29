/**
 * Unit tests for module access: the modules config helpers and the
 * requireModule middleware guard.
 */

const { MODULE_KEYS, parseModules, serializeModules } = require('../config/modules');
const { requireModule } = require('../middleware/auth');

describe('parseModules', () => {
  it('returns null for unset values (= full access)', () => {
    expect(parseModules(null)).toBeNull();
    expect(parseModules(undefined)).toBeNull();
    expect(parseModules('')).toBeNull();
  });

  it('parses a JSON array and drops unknown keys', () => {
    expect(parseModules('["inventory","vend"]')).toEqual(['inventory', 'vend']);
    expect(parseModules('["inventory","bogus"]')).toEqual(['inventory']);
    expect(parseModules('[]')).toEqual([]);
  });

  it('returns null on malformed JSON', () => {
    expect(parseModules('not json')).toBeNull();
    expect(parseModules('{"a":1}')).toBeNull();
  });
});

describe('serializeModules', () => {
  it('serializes valid keys, deduped, and null for non-arrays', () => {
    expect(serializeModules(['inventory', 'inventory', 'vend'])).toBe('["inventory","vend"]');
    expect(serializeModules(['bogus'])).toBe('[]');
    expect(serializeModules([])).toBe('[]');
    expect(serializeModules(undefined)).toBeNull();
    expect(serializeModules('inventory')).toBeNull();
  });

  it('only exposes the four integration modules', () => {
    expect(MODULE_KEYS).toEqual(['inventory', 'receipts', 'ar-invoice', 'vend']);
  });
});

describe('requireModule', () => {
  const run = (user, key) => {
    const req = { user };
    let status = null;
    const res = { status: (s) => { status = s; return { json: () => {} }; } };
    let passed = false;
    requireModule(key)(req, res, () => { passed = true; });
    return { passed, status };
  };

  it('allows admins regardless of modules', () => {
    expect(run({ role: 'ADMIN', modules: [] }, 'vend').passed).toBe(true);
  });

  it('allows users whose modules are unset (legacy = full access)', () => {
    expect(run({ role: 'USER', modules: null }, 'vend').passed).toBe(true);
  });

  it('allows a user holding the module and blocks one who does not', () => {
    expect(run({ role: 'USER', modules: ['vend'] }, 'vend').passed).toBe(true);
    expect(run({ role: 'USER', modules: ['inventory'] }, 'vend')).toEqual({ passed: false, status: 403 });
    expect(run({ role: 'USER', modules: [] }, 'vend')).toEqual({ passed: false, status: 403 });
  });

  it('401s when unauthenticated', () => {
    expect(run(undefined, 'vend')).toEqual({ passed: false, status: 401 });
  });
});

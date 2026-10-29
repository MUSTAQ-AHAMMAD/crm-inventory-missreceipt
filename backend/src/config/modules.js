/**
 * Access modules – the integration areas a user can be granted or denied.
 * Keys are shared with the frontend (frontend/src/constants/modules.js) and
 * the route mounts in index.js. Dashboard, Reports & Logs and Help are not
 * module-gated (available to every authenticated user); Admin is role-gated.
 */

const MODULE_KEYS = ['inventory', 'receipts', 'ar-invoice', 'vend'];

/**
 * Parses the stored `modules` string into an array of valid keys, or null when
 * unset. NULL means full access (legacy users); an array (possibly empty) means
 * access is limited to exactly those keys.
 */
function parseModules(value) {
  if (value == null || value === '') return null;
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter((k) => MODULE_KEYS.includes(k)) : null;
  } catch {
    return null;
  }
}

/**
 * Serializes an array of module keys for storage. Returns null when given a
 * non-array (→ full access); drops unknown keys and duplicates.
 */
function serializeModules(arr) {
  if (!Array.isArray(arr)) return null;
  const valid = [...new Set(arr.filter((k) => MODULE_KEYS.includes(k)))];
  return JSON.stringify(valid);
}

module.exports = { MODULE_KEYS, parseModules, serializeModules };

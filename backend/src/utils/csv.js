/**
 * Shared CSV helpers used by the report and inventory export endpoints.
 */

/**
 * Escapes a single value for inclusion in a CSV field.
 * Wraps the value in double quotes and escapes embedded quotes by doubling them.
 * Newlines are normalized to spaces so they don't break the CSV row structure.
 *
 * @param {*} value
 * @returns {string}
 */
function csvEscape(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value).replace(/"/g, '""').replace(/\r?\n/g, ' ');
  return `"${str}"`;
}

module.exports = { csvEscape };

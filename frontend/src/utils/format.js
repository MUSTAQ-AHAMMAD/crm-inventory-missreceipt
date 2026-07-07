/**
 * Safe display helpers shared across pages.
 */

/**
 * Convert any value to readable text for display.
 * Objects/arrays are pretty-printed as JSON instead of rendering as "[object Object]".
 */
export function toDisplayText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Filter an uploads/history list by a free-text search, status, and date range.
 * - search: case-insensitive substring across id, filename, status, counts,
 *   response message/log, and user email (flexible — matches any field).
 * - status: exact status match (case-insensitive); '' = all.
 * - from/to: inclusive date range (YYYY-MM-DD) over createdAt; '' = unbounded.
 */
export function filterUploads(uploads, { search = '', status = '', from = '', to = '' } = {}) {
  const q = String(search || '').trim().toLowerCase();
  const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : null;
  const toTs = to ? new Date(`${to}T23:59:59`).getTime() : null;

  return (uploads || []).filter((u) => {
    const rowStatus = u.status ?? u.responseStatus ?? '';
    if (status && String(rowStatus).toUpperCase() !== String(status).toUpperCase()) return false;

    if (fromTs != null || toTs != null) {
      const t = u.createdAt ? new Date(u.createdAt).getTime() : null;
      if (t == null || Number.isNaN(t)) return false;
      if (fromTs != null && t < fromTs) return false;
      if (toTs != null && t > toTs) return false;
    }

    if (q) {
      const hay = [
        u.id,
        u.filename,
        u.status,
        u.responseStatus,
        u.successCount,
        u.failureCount,
        u.responseMessage,
        u.responseLog,
        u.user && u.user.email,
      ]
        .map(toDisplayText)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

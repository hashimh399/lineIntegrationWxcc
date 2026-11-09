/**
 * Webex echoes `origin.id` back as `data.origin`. Older events may send `{ id }`.
 * @param {string | { id?: string } | null | undefined} origin
 * @returns {string | null}
 */
function originToString(origin) {
  if (origin == null) return null;
  if (typeof origin === 'object') {
    return origin.id != null ? String(origin.id) : null;
  }
  const value = String(origin).trim();
  return value.length ? value : null;
}

/**
 * Split a namespaced customer id `<provider>:<customerId>` on the first colon.
 * @param {string | { id?: string } | null | undefined} origin
 * @returns {{ provider: string, customerId: string, namespacedId: string } | null}
 */
function parseNamespacedOrigin(origin) {
  const namespacedId = originToString(origin);
  if (!namespacedId) return null;

  const separator = namespacedId.indexOf(':');
  if (separator <= 0 || separator === namespacedId.length - 1) return null;

  return {
    provider: namespacedId.slice(0, separator),
    customerId: namespacedId.slice(separator + 1),
    namespacedId
  };
}

module.exports = { originToString, parseNamespacedOrigin };

'use strict';

/**
 * nanp-normalize.js -- Normalize phone-like strings to E.164 NANP format.
 *
 * Handles the common shapes Contacts.app emits:
 *   "+1 (902) 401-9627", "(902) 401-9627", "902-401-9627", "9024019627",
 *   "1-902-401-9627", "+19024019627"  → "+19024019627"
 *
 * Emails pass through lowercased and trimmed.
 * Anything else returns null.
 */

function normalize(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (s.includes('@')) {
    // Email handle (iMessage Apple ID)
    return s.toLowerCase();
  }

  const digits = s.replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Already E.164 with country code other than NANP, or short codes — pass if 11–15 with leading +
  if (/^\+\d{11,15}$/.test(s.replace(/\s/g, ''))) return s.replace(/\s/g, '');
  return null;
}

module.exports = { normalize };

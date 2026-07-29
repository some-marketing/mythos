'use strict';

/**
 * sheet-payload.cjs — Google Drive file metadata and MIME payload generator (S7).
 */

const MIME_CSV = 'text/csv';
const DRIVE_FILE_API_LIMIT = 5 * 1024 * 1024; // 5MB standard upload threshold

/**
 * Formulates the metadata and payload body for Google Drive's multipart upload API.
 *
 * @param {string} fileName The desired Google Sheets filename
 * @param {string} csvContent The escaped raw CSV string
 * @returns {object} { metadata, media: { mimeType, body } }
 */
function buildDriveUploadPayload(fileName, csvContent) {
  if (!fileName) throw new Error('fileName is required for Drive upload');
  if (typeof csvContent !== 'string') throw new Error('csvContent must be a string');

  const byteLength = Buffer.byteLength(csvContent, 'utf8');
  if (byteLength > DRIVE_FILE_API_LIMIT) {
    throw new Error(`CSV payload size (${(byteLength / 1024 / 1024).toFixed(2)}MB) exceeds standard multipart upload limits.`);
  }

  return {
    metadata: {
      name: fileName,
      mimeType: 'application/vnd.google-apps.spreadsheet', // Auto-converts CSV to Google Sheets on upload
    },
    media: {
      mimeType: MIME_CSV,
      body: csvContent
    }
  };
}

module.exports = {
  MIME_CSV,
  buildDriveUploadPayload
};

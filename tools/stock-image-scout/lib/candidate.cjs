'use strict';

/**
 * candidate.cjs — Normalized candidate definition and validator.
 */

function validateCandidate(candidate, providerName) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Candidate must be an object');
  }
  const { id, url, title, thumbnail, orientation, downloadable_under_plan } = candidate;

  if (!id || typeof id !== 'string') {
    throw new Error('Candidate must have a string id');
  }

  if (providerName === 'depositphotos') {
    if (!/^\d{6,12}$/.test(id)) {
      throw new Error(`Depositphotos candidate id must be a 6-12 digit string, got "${id}"`);
    }
  } else if (!id.trim()) {
    throw new Error('Candidate id cannot be empty');
  }

  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    throw new Error(`Candidate url must be an https URL, got "${url}"`);
  }

  if (typeof title !== 'string') {
    throw new Error('Candidate title must be a string');
  }

  if (!thumbnail || typeof thumbnail !== 'string' || !thumbnail.startsWith('https://')) {
    throw new Error(`Candidate thumbnail must be an https URL, got "${thumbnail}"`);
  }

  if (!orientation || !['horizontal', 'vertical', 'square', 'unknown'].includes(orientation)) {
    throw new Error(`Candidate orientation must be one of: horizontal, vertical, square, unknown. Got "${orientation}"`);
  }

  if (typeof downloadable_under_plan !== 'boolean') {
    throw new Error('Candidate downloadable_under_plan must be a boolean');
  }

  return {
    id,
    url,
    title,
    thumbnail,
    orientation,
    downloadable_under_plan
  };
}

module.exports = {
  validateCandidate
};

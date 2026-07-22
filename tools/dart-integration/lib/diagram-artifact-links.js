'use strict';

const path = require('node:path');

function isHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalPathLike(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const raw = value.trim();
  if (/^file:\/\//i.test(raw)) return true;
  if (path.isAbsolute(raw)) return true;
  if (/^[A-Za-z]:[\\/]/.test(raw)) return true;
  return false;
}

function validatePublishUrl(publishUrl, options = {}) {
  if (!publishUrl) return { ok: true, value: '', attachmentAllowed: false, reason: 'no-publish-url' };
  const value = String(publishUrl).trim();
  if (!isHttpUrl(value)) {
    return {
      ok: false,
      value,
      attachmentAllowed: false,
      reason: isLocalPathLike(value) ? 'local-path-not-allowed' : 'not-http-url'
    };
  }
  const allowedHosts = Array.isArray(options.allowedHosts) ? options.allowedHosts.filter(Boolean) : [];
  if (allowedHosts.length) {
    const host = new URL(value).hostname;
    if (!allowedHosts.includes(host)) {
      return { ok: false, value, attachmentAllowed: false, reason: `host-not-allowed:${host}` };
    }
  }
  return { ok: true, value, attachmentAllowed: true, reason: 'http-url' };
}

function buildAttachmentRequest({ taskId, publishUrl, title }) {
  const validation = validatePublishUrl(publishUrl);
  if (!validation.ok || !validation.attachmentAllowed) return null;
  return {
    kind: 'dart_url_attachment_request',
    executable_in_v1: false,
    reason: 'The local Dart API wrapper has no implemented task attachment endpoint; execute only through an approved URL-attachment surface after review.',
    task_id: taskId || null,
    url: validation.value,
    title: title || 'Mythos plan diagram publication'
  };
}

function formatPathLine(label, value) {
  if (!value) return null;
  return `- ${label}: \`${value}\``;
}

function buildDiagramArtifactComment(publication, options = {}) {
  if (!publication || typeof publication !== 'object') {
    throw new Error('publication is required');
  }
  const plan = publication.plan || {};
  const artifacts = publication.artifacts || {};
  const links = publication.links || {};
  const publishUrl = links.publish_url || '';
  const lines = [
    `Mythos plan diagram package updated for \`${plan.task_id || publication.task_id || 'unknown-plan'}\`.`,
    '',
    'Artifact Index:'
  ];

  if (publishUrl) {
    lines.push(`- Published diagram/package: ${publishUrl}`);
  }
  lines.push(
    formatPathLine('Source plan', artifacts.plan_json),
    formatPathLine('Source markdown', artifacts.plan_markdown),
    formatPathLine('Draw.io diagram', artifacts.diagram),
    formatPathLine('Draw.io baseline', artifacts.baseline),
    formatPathLine('Publication packet', artifacts.publication),
    formatPathLine('Local visual library', artifacts.visual_library),
    formatPathLine('Local dashboard', artifacts.dashboard)
  );
  if (Array.isArray(artifacts.related) && artifacts.related.length) {
    for (const item of artifacts.related) {
      lines.push(formatPathLine(item.label || 'Related artifact', item.path || item));
    }
  }

  lines.push(
    '',
    `Lifecycle event: \`${publication.lifecycle_event || 'manual'}\``,
    `Plan status: \`${plan.status || 'unknown'}\``,
    '',
    'Authority: repo task-plan JSON/Markdown remains source of truth. This diagram package is derived context for review and operator understanding.'
  );

  if (options.includeAttachmentNote !== false && publishUrl) {
    lines.push('', 'Attachment note: this URL is linkable in Dart. Native Dart attachment execution is not attempted by this v1 publisher.');
  }

  return lines.filter((line) => line !== null && line !== undefined).join('\n');
}

module.exports = {
  isHttpUrl,
  isLocalPathLike,
  validatePublishUrl,
  buildAttachmentRequest,
  buildDiagramArtifactComment
};

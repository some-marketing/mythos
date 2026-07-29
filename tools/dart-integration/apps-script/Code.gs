/**
 * Mythos Dart Integration — Google Apps Script
 *
 * Two flows:
 *   1. Client emails (Gmail) → Dart tasks/comments
 *   2. Gemini meeting notes (Drive) → Dart tasks/comments
 *
 * Setup:
 *   1. Set DART_TOKEN in Script Properties (File > Project Settings > Script Properties)
 *   2. Update CLIENT_ROUTING with your actual client email domains
 *   3. Create Gmail label "dart/pending" for email processing
 *   4. Set up time-driven triggers (see setupTriggers())
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DART_API_BASE = 'https://app.dartai.com/api/v0/public';
const GMAIL_LABEL_PENDING = 'dart/pending';
const GMAIL_LABEL_PROCESSED = 'dart/processed';
const MEET_NOTES_FOLDER_NAME = 'Meet Notes';
// Base Drive folder where inbound email/notes attachments are stored, then linked
// onto the Dart task. Per-client subfolders are created under this. Keep this folder
// PRIVATE — attachments can contain sensitive client data; the Dart link only works
// for people with Drive access to it.
const ATTACHMENTS_FOLDER_NAME = 'Dart Attachments';

/**
 * Client routing map.
 * Update email domains and dartboard names to match your Dart workspace.
 * Dartboard names must exactly match what's in Dart (space/board format).
 */
// CANONICAL SOURCE: tools/dart-integration/client-routing.json in the Mythos repo.
// This object is a deploy-time mirror — the deployed Apps Script must be kept in
// sync with that file by hand until the dynamic loader (see SETUP.md / proposal)
// is wired up. Keys must be unique: JS object literals silently keep only the LAST
// duplicate, so a repeated key is a real (if currently harmless) routing bug.
const CLIENT_ROUTING = {
  'client-a.example':        { code: 'EXAMPLECOA', dartboard: "Client Group/Client A" },
  'user@client-a.example':   { code: 'EXAMPLECOA', dartboard: "Client Group/Client A" },
  'client-b.example':        { code: 'EXAMPLECOB', dartboard: 'Example Agency/Client B' },
  'client-c.example':        { code: 'EXAMPLECOC', dartboard: "Client Group/Client C" },
  'client-d.example':        { code: 'EXAMPLECOD', dartboard: "Client Group/Client D" },
};

const MEETING_KEYWORDS = {
  'client a':            { code: 'EXAMPLECOA', dartboard: "Client Group/Client A" },
  'client-a':            { code: 'EXAMPLECOA', dartboard: "Client Group/Client A" },
  'client stakeholder':  { code: 'EXAMPLECOA', dartboard: "Client Group/Client A" },
  'client b':            { code: 'EXAMPLECOB', dartboard: 'Example Agency/Client B' },
  'client b sub-brand':  { code: 'EXAMPLECOB', dartboard: 'Example Agency/Client B' },
  'client c':            { code: 'EXAMPLECOC', dartboard: "Client Group/Client C" },
  'client d':            { code: 'EXAMPLECOD', dartboard: "Client Group/Client D" },
  'clientd':             { code: 'EXAMPLECOD', dartboard: "Client Group/Client D" },
};

const FALLBACK_DARTBOARD = 'General/Tasks';

// ---------------------------------------------------------------------------
// Dart API helpers
// ---------------------------------------------------------------------------

function getDartToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('DART_TOKEN');
  if (!token) throw new Error('DART_TOKEN not set in Script Properties');
  return token;
}

function dartRequest_(method, endpoint, payload) {
  const options = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + getDartToken_(),
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  };
  if (payload) options.payload = JSON.stringify(payload);

  const response = UrlFetchApp.fetch(DART_API_BASE + endpoint, options);
  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code >= 400) {
    Logger.log('Dart API error ' + code + ': ' + body);
    throw new Error('Dart API ' + method + ' ' + endpoint + ' failed: ' + code);
  }

  return body ? JSON.parse(body) : null;
}

// ---------------------------------------------------------------------------
// Dart operations
// ---------------------------------------------------------------------------

/**
 * Search for existing tasks by title keyword within a dartboard.
 * Returns the first matching task or null.
 */
function findExistingTask_(dartboard, searchTerms) {
  const params = new URLSearchParams();
  params.append('dartboard', dartboard);
  params.append('title', searchTerms);
  params.append('limit', '5');

  const results = dartRequest_('GET', '/tasks?' + params.toString());
  if (results && results.results && results.results.length > 0) {
    return results.results[0];
  }
  return null;
}

/**
 * Create a new task on the specified dartboard.
 */
function createTask_(dartboard, title, description, tags) {
  const payload = {
    dartboard: dartboard,
    title: title,
    description: description,
    status: 'To-do',
  };
  if (tags && tags.length > 0) payload.tags = tags;
  return dartRequest_('POST', '/tasks', payload);
}

/**
 * Add a comment to an existing task.
 */
function addTaskComment_(taskId, commentText) {
  return dartRequest_('POST', '/comments', {
    task_id: taskId,
    text: commentText,
  });
}

// ---------------------------------------------------------------------------
// Attachments → Drive → link (Dart has no native upload endpoint as of 2026-05-29)
// ---------------------------------------------------------------------------

/**
 * Return (creating if needed) a Drive folder by name under an optional parent.
 * @param {string} name
 * @param {Folder} [parent] - defaults to My Drive root
 * @returns {Folder}
 */
function getOrCreateDriveFolder_(name, parent) {
  const root = parent || DriveApp.getRootFolder();
  const existing = root.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return root.createFolder(name);
}

/**
 * Save a message's attachments to "Dart Attachments/<clientCode>/" in Drive and
 * return link metadata. Skips inline images and zero-byte parts. Fail-soft: a
 * single attachment error is logged and skipped, never aborts task creation.
 * @param {GmailMessage} message
 * @param {string} clientCode
 * @returns {Array<{name:string, url:string}>}
 */
function saveAttachmentsToDrive_(message, clientCode) {
  const out = [];
  let attachments;
  try {
    attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  } catch (e) {
    Logger.log('getAttachments failed: ' + e.message);
    return out;
  }
  if (!attachments || attachments.length === 0) return out;

  const base = getOrCreateDriveFolder_(ATTACHMENTS_FOLDER_NAME);
  const folder = getOrCreateDriveFolder_(clientCode || 'UNKNOWN', base);

  for (const att of attachments) {
    try {
      if (att.getSize && att.getSize() === 0) continue;
      const file = folder.createFile(att.copyBlob());
      out.push({ name: file.getName(), url: file.getUrl() });
    } catch (e) {
      Logger.log('Failed to save attachment "' + (att.getName ? att.getName() : '?') + '": ' + e.message);
    }
  }
  return out;
}

/**
 * Format saved-attachment links as a markdown block for a task/comment body.
 * Returns '' when there are no links.
 * @param {Array<{name:string, url:string}>} links
 * @returns {string}
 */
function formatAttachmentLinks_(links) {
  if (!links || links.length === 0) return '';
  const lines = links.map(function (l) { return '- [' + l.name + '](' + l.url + ')'; });
  return '\n\n**Attachments** (saved to Drive — Dart has no native upload):\n' + lines.join('\n');
}

// ---------------------------------------------------------------------------
// Client matching
// ---------------------------------------------------------------------------

/**
 * Match a sender email to a client config.
 * Checks exact email first, then domain.
 */
function matchClientByEmail_(senderEmail) {
  const email = senderEmail.toLowerCase().trim();

  // Check exact email match
  if (CLIENT_ROUTING[email]) return CLIENT_ROUTING[email];

  // Check domain match
  const domain = email.split('@')[1];
  if (domain && CLIENT_ROUTING[domain]) return CLIENT_ROUTING[domain];

  return null;
}

/**
 * Match a meeting title to a client config.
 * Checks if any keyword appears in the title.
 */
function matchClientByMeetingTitle_(title) {
  const lower = title.toLowerCase();
  for (const keyword in MEETING_KEYWORDS) {
    if (lower.includes(keyword)) {
      return MEETING_KEYWORDS[keyword];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flow 1: Client Emails → Dart
// ---------------------------------------------------------------------------

/**
 * Process labeled Gmail threads and route to Dart.
 * Set this to run on a time-driven trigger (every 5-10 minutes).
 */
function processClientEmails() {
  const pendingLabel = GmailApp.getUserLabelByName(GMAIL_LABEL_PENDING);
  const processedLabel = getOrCreateLabel_(GMAIL_LABEL_PROCESSED);

  if (!pendingLabel) {
    Logger.log('Label "' + GMAIL_LABEL_PENDING + '" not found. Create it and set up Gmail filters.');
    return;
  }

  const threads = pendingLabel.getThreads(0, 20); // Process up to 20 at a time
  if (threads.length === 0) {
    Logger.log('No pending client emails.');
    return;
  }

  Logger.log('Processing ' + threads.length + ' email thread(s)...');

  for (const thread of threads) {
    try {
      processEmailThread_(thread);
    } catch (e) {
      Logger.log('Error processing thread "' + thread.getFirstMessageSubject() + '": ' + e.message);
    }

    // Move from pending to processed
    thread.removeLabel(pendingLabel);
    thread.addLabel(processedLabel);
  }
}

function processEmailThread_(thread) {
  const messages = thread.getMessages();
  const latestMessage = messages[messages.length - 1];
  const subject = thread.getFirstMessageSubject();
  const senderFull = latestMessage.getFrom();
  const senderEmail = extractEmail_(senderFull);
  const body = latestMessage.getPlainBody();
  const date = latestMessage.getDate();

  const client = matchClientByEmail_(senderEmail);
  const dartboard = (client && client.dartboard) || FALLBACK_DARTBOARD;
  const clientCode = client ? client.code : 'UNKNOWN';

  Logger.log('Email from ' + senderEmail + ' → client: ' + clientCode + ' → dartboard: ' + dartboard);

  // Preserve any email attachments by saving them to Drive and linking them on the task.
  const attachmentLinks = formatAttachmentLinks_(saveAttachmentsToDrive_(latestMessage, clientCode));

  // Try to find an existing task with a similar subject on this dartboard
  const existingTask = findExistingTask_(dartboard, subject);

  if (existingTask) {
    // Append as comment to existing task
    const comment = formatEmailAsComment_(senderFull, date, subject, body) + attachmentLinks;
    addTaskComment_(existingTask.id, comment);
    Logger.log('Added comment to existing task: ' + existingTask.title);
  } else {
    // Create new task
    const description = formatEmailAsDescription_(senderFull, date, body) + attachmentLinks;
    const tags = ['email'];
    if (clientCode !== 'UNKNOWN') tags.push(clientCode.toLowerCase());
    createTask_(dartboard, '[Email] ' + subject, description, tags);
    Logger.log('Created new task: [Email] ' + subject);
  }
}

// ---------------------------------------------------------------------------
// Flow 2: Gemini Meeting Notes → Dart
// ---------------------------------------------------------------------------

/**
 * Process new meeting notes from the Meet Notes folder.
 * Set this to run on a time-driven trigger (every 15-30 minutes).
 */
function processMeetingNotes() {
  const folders = DriveApp.getFoldersByName(MEET_NOTES_FOLDER_NAME);
  if (!folders.hasNext()) {
    Logger.log('No "' + MEET_NOTES_FOLDER_NAME + '" folder found in Drive.');
    return;
  }

  const folder = folders.next();
  const processedTag = 'dart-processed';

  // Get docs modified in the last hour (adjust window as needed for your trigger interval)
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const files = folder.getFiles();

  let processed = 0;

  while (files.hasNext()) {
    const file = files.next();

    // Skip if already processed (check description field as a marker)
    if (file.getDescription() && file.getDescription().includes(processedTag)) continue;

    // Skip if older than our window
    if (file.getLastUpdated() < cutoff) continue;

    try {
      processMeetingNote_(file);
      processed++;
    } catch (e) {
      Logger.log('Error processing meeting note "' + file.getName() + '": ' + e.message);
    }

    // Mark as processed
    const desc = (file.getDescription() || '') + ' ' + processedTag;
    file.setDescription(desc.trim());
  }

  Logger.log('Processed ' + processed + ' meeting note(s).');
}

function processMeetingNote_(file) {
  const title = file.getName();
  const doc = DocumentApp.openById(file.getId());
  const body = doc.getBody().getText();
  const date = file.getLastUpdated();

  const client = matchClientByMeetingTitle_(title);
  const dartboard = (client && client.dartboard) || FALLBACK_DARTBOARD;
  const clientCode = client ? client.code : 'UNKNOWN';

  Logger.log('Meeting note "' + title + '" → client: ' + clientCode + ' → dartboard: ' + dartboard);

  // Try to find an existing task related to this meeting
  const searchTerms = title.replace(/meeting notes?/gi, '').trim();
  const existingTask = searchTerms ? findExistingTask_(dartboard, searchTerms) : null;

  if (existingTask) {
    const comment = formatMeetingNoteAsComment_(title, date, body);
    addTaskComment_(existingTask.id, comment);
    Logger.log('Added meeting notes to existing task: ' + existingTask.title);
  } else {
    const description = formatMeetingNoteAsDescription_(title, date, body, file.getUrl());
    const tags = ['meeting-notes'];
    if (clientCode !== 'UNKNOWN') tags.push(clientCode.toLowerCase());
    createTask_(dartboard, '[Meeting] ' + title, description, tags);
    Logger.log('Created new task: [Meeting] ' + title);
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatEmailAsComment_(sender, date, subject, body) {
  return '**Email received** — ' + formatDate_(date) + '\n' +
         '**From:** ' + sender + '\n' +
         '**Subject:** ' + subject + '\n\n' +
         '---\n\n' +
         body;
}

function formatEmailAsDescription_(sender, date, body) {
  return '**From:** ' + sender + '\n' +
         '**Date:** ' + formatDate_(date) + '\n\n' +
         '---\n\n' +
         body;
}

function formatMeetingNoteAsComment_(title, date, body) {
  return '**Meeting notes added** — ' + formatDate_(date) + '\n' +
         '**Meeting:** ' + title + '\n\n' +
         '---\n\n' +
         body;
}

function formatMeetingNoteAsDescription_(title, date, body, docUrl) {
  return '**Meeting:** ' + title + '\n' +
         '**Date:** ' + formatDate_(date) + '\n' +
         '**Source:** [Google Doc](' + docUrl + ')\n\n' +
         '---\n\n' +
         body;
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function extractEmail_(fromHeader) {
  const match = fromHeader.match(/<(.+?)>/);
  return match ? match[1].toLowerCase() : fromHeader.toLowerCase().trim();
}

function getOrCreateLabel_(name) {
  let label = GmailApp.getUserLabelByName(name);
  if (!label) label = GmailApp.createLabel(name);
  return label;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Run this once to create the time-driven triggers.
 */
function setupTriggers() {
  // Email processing — every 5 minutes
  ScriptApp.newTrigger('processClientEmails')
    .timeBased()
    .everyMinutes(5)
    .create();

  // Meeting notes processing — every 15 minutes
  ScriptApp.newTrigger('processMeetingNotes')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Triggers created: processClientEmails (5m), processMeetingNotes (15m)');
}

/**
 * Run this to remove all triggers (for cleanup/reset).
 */
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
  Logger.log('All triggers removed.');
}

/**
 * Test the Dart API connection.
 */
function testDartConnection() {
  try {
    const result = dartRequest_('GET', '/tasks?limit=1');
    Logger.log('Dart API connected. Found ' + (result.count || 0) + ' total tasks.');
  } catch (e) {
    Logger.log('Dart API connection failed: ' + e.message);
  }
}

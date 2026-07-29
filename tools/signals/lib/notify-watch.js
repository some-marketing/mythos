'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  buildLoopState,
  deriveLoopRecommendation
} = require('./pipeline-loop');
const {
  buildWorkstreamState,
  deriveWorkstreamRecommendation
} = require('./workstream-loop');

function buildMainSnapshot(projectRoot) {
  const state = buildLoopState(projectRoot);
  const recommendation = deriveLoopRecommendation(state);
  const latestSignal = recommendation.latest_signal;
  return {
    watcher: 'main',
    scope: 'advance-pipeline',
    command: recommendation.command || '',
    reason: recommendation.reason || '',
    blocked_by: recommendation.blocked_by || [],
    latest_signal_file: latestSignal ? latestSignal.name : '',
    latest_signal_type: latestSignal ? latestSignal.signal.signal_type || '' : '',
    latest_signal_source: latestSignal ? latestSignal.signal.source || '' : ''
  };
}

function buildWorkstreamSnapshot(projectRoot, signalScope) {
  const state = buildWorkstreamState(projectRoot, signalScope);
  const recommendation = deriveWorkstreamRecommendation(state);
  const latestSignal = recommendation.latest_signal;
  return {
    watcher: 'workstream',
    scope: signalScope,
    command: recommendation.command || '',
    reason: recommendation.reason || '',
    blocked_by: recommendation.blocked_by || [],
    latest_signal_file: latestSignal ? latestSignal.name : '',
    latest_signal_type: latestSignal ? latestSignal.signal.signal_type || '' : '',
    latest_signal_source: latestSignal ? latestSignal.signal.source || '' : ''
  };
}

function buildNotificationKey(snapshot) {
  return JSON.stringify([
    snapshot.watcher,
    snapshot.scope,
    snapshot.command,
    snapshot.reason,
    snapshot.latest_signal_file,
    snapshot.latest_signal_type,
    snapshot.latest_signal_source,
    snapshot.blocked_by.join('|')
  ]);
}

function formatNotificationLine(snapshot) {
  const blocked = snapshot.blocked_by.length > 0
    ? ` blocked_by=${snapshot.blocked_by.join('; ')}`
    : '';
  return `[${new Date().toISOString()}] ${snapshot.watcher}:${snapshot.scope} command=${snapshot.command || '(none)'} signal=${snapshot.latest_signal_type || 'none'}:${snapshot.latest_signal_source || 'none'} file=${snapshot.latest_signal_file || 'none'}${blocked}`;
}

function appendJsonl(logPath, payload) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`);
}

function maybeMacNotify(snapshot, enableMacNotify) {
  if (!enableMacNotify) return false;
  if (process.platform !== 'darwin') return false;

  const title = snapshot.watcher === 'main'
    ? 'Mythos Pipeline Update'
    : `Mythos Workstream Update`;
  const subtitle = snapshot.watcher === 'main'
    ? snapshot.scope
    : `signal_scope: ${snapshot.scope}`;
  const message = snapshot.command
    ? `Next: ${snapshot.command}`
    : snapshot.reason || 'No command recommended';

  execFileSync('osascript', [
    '-e',
    `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} subtitle ${JSON.stringify(subtitle)}`
  ], { stdio: 'ignore' });
  return true;
}

module.exports = {
  appendJsonl,
  buildMainSnapshot,
  buildNotificationKey,
  buildWorkstreamSnapshot,
  formatNotificationLine,
  maybeMacNotify
};

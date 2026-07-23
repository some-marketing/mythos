const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Resolve the user's Chrome profile directory.
 *
 * On macOS, Chrome profiles live under:
 *   ~/Library/Application Support/Google/Chrome/<ProfileName>
 *
 * If no --chrome-profile flag is provided, uses "Default".
 * Validates the profile directory exists before returning.
 */

const CHROME_BASE_MAC = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome'
);

function resolveProfile(profileNameOrPath) {
  // If an absolute path was provided, use it directly
  if (profileNameOrPath && path.isAbsolute(profileNameOrPath)) {
    if (!fs.existsSync(profileNameOrPath)) {
      throw new Error(
        `Chrome profile not found at: ${profileNameOrPath}\n` +
        'Provide a valid path or profile name (e.g., "Default", "Profile 1").'
      );
    }
    return {
      profilePath: profileNameOrPath,
      profileName: path.basename(profileNameOrPath)
    };
  }

  if (process.platform !== 'darwin') {
    throw new Error(
      'Chrome profile auto-detection is only supported on macOS.\n' +
      'Provide an explicit path with --chrome-profile <path>.'
    );
  }

  if (!fs.existsSync(CHROME_BASE_MAC)) {
    throw new Error(
      `Chrome data directory not found at: ${CHROME_BASE_MAC}\n` +
      'Is Google Chrome installed?'
    );
  }

  const name = profileNameOrPath || 'Default';
  const profilePath = path.join(CHROME_BASE_MAC, name);

  if (!fs.existsSync(profilePath)) {
    const available = listProfiles();
    throw new Error(
      `Chrome profile "${name}" not found.\n` +
      `Available profiles: ${available.join(', ')}\n` +
      'Use --chrome-profile <name> to specify.'
    );
  }

  return { profilePath, profileName: name };
}

/**
 * List available Chrome profile directories.
 */
function listProfiles() {
  if (!fs.existsSync(CHROME_BASE_MAC)) return [];

  return fs.readdirSync(CHROME_BASE_MAC, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => name === 'Default' || name.startsWith('Profile '))
    .sort((a, b) => {
      if (a === 'Default') return -1;
      if (b === 'Default') return 1;
      const numA = parseInt(a.replace('Profile ', ''), 10);
      const numB = parseInt(b.replace('Profile ', ''), 10);
      return numA - numB;
    });
}

/**
 * Get profile display info (name from Preferences file if available).
 */
function getProfileInfo(profilePath) {
  const prefsPath = path.join(profilePath, 'Preferences');
  const info = { profilePath, profileName: path.basename(profilePath) };

  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    if (prefs.profile && prefs.profile.name) {
      info.displayName = prefs.profile.name;
    }
    if (prefs.account_info && prefs.account_info.length > 0) {
      info.googleAccount = prefs.account_info[0].email || '(logged in)';
    }
  } catch {
    // Preferences file may not exist or be readable
  }

  return info;
}

module.exports = { resolveProfile, listProfiles, getProfileInfo, CHROME_BASE_MAC };

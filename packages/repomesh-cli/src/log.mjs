// Structured logging helpers for repomesh CLI.
// Uses process.argv directly so flags work before Commander parses.
const argv = process.argv;
export const isQuiet = () => argv.includes('--quiet') || argv.includes('-q');
export const isVerbose = () => argv.includes('--verbose') || argv.includes('-v');
export const isDebug = () => argv.includes('--debug');
export const isNoColor = () => argv.includes('--no-color') || !!process.env.NO_COLOR;

// Strip ANSI escape codes from a string.
export function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Map common emoji to text equivalents for accessible/no-color output.
const EMOJI_MAP = { '\u2705': '[OK]', '\u274c': '[FAIL]', '\u26a0\ufe0f': '[WARN]', '\u26a0': '[WARN]', '\u2192': '->' };
export function deEmoji(str) {
  let out = str;
  for (const [emoji, text] of Object.entries(EMOJI_MAP)) {
    out = out.split(emoji).join(text);
  }
  return out;
}

// Apply no-color transforms when active.
export function clean(msg) {
  if (!isNoColor()) return msg;
  return deEmoji(stripAnsi(String(msg)));
}

export function log(msg) { if (!isQuiet()) console.error(clean(msg)); }
export function verbose(msg) { if (isVerbose() || isDebug()) console.error(clean(msg)); }
export function debug(msg) { if (isDebug()) console.error(clean('[debug] ' + msg)); }

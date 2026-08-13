// Shared say-to-me session id patterns for OpenCode and external CLI agents.
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export const CLAUDE_SESSION_ID = `cc_${UUID}`;
export const CURSOR_SESSION_ID = `cur_${UUID}`;
export const CODEX_SESSION_ID = `cx_${UUID}`;
export const GROK_SESSION_ID = `gr_${UUID}`;
export const T3_SESSION_ID = `t3_${UUID}`;
export const PASEO_SESSION_ID = `pa_${UUID}`;
export const VOICE_SESSION_ID = `vo_[A-Za-z0-9][A-Za-z0-9._-]{0,127}`;
export const EXTERNAL_CLI_SESSION_ID = `(?:${CLAUDE_SESSION_ID}|${CURSOR_SESSION_ID}|${CODEX_SESSION_ID}|${GROK_SESSION_ID}|${T3_SESSION_ID}|${PASEO_SESSION_ID})`;
export const SESSION_MENTION_ID = `ses_[A-Za-z0-9]{26}|${EXTERNAL_CLI_SESSION_ID}|${VOICE_SESSION_ID}`;

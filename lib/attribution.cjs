"use strict";

// Shared AI-attribution resolution for MyAnyAgent. Single source of truth for
// "which Co-authored-by trailer should commits in this repo carry".
//
// Precedence: MYANYAGENT_ATTRIBUTION env > [identity].co_author > [bot] block.
// The trailer value format is the git-standard "Name <email>".

const fs = require("node:fs");

const TRAILER_KEY = "Co-authored-by";

// Minimal section-aware toml reader (same scope as bootstrap.sh's toml_get_in).
// Only reads top-level keys and [bot]/[identity] string values.
function readToml(tomlPath) {
  let text;
  try {
    text = fs.readFileSync(tomlPath, "utf8");
  } catch {
    return { top: {}, sections: {} };
  }
  const result = { top: {}, sections: {} };
  let section = "top";
  for (const line of text.split(/\r?\n/)) {
    const s = line.match(/^\s*\[([^\]]+)\]/);
    if (s) {
      section = s[1].trim();
      if (!result.sections[section]) result.sections[section] = {};
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/);
    if (kv) {
      const target = section === "top" ? result.top : result.sections[section];
      target[kv[1]] = kv[2];
    }
  }
  return result;
}

function resolveAttribution({ tomlPath, gitConfigGet, env }) {
  const e = env || {};
  if (e.MYANYAGENT_ATTRIBUTION && e.MYANYAGENT_ATTRIBUTION.trim()) {
    return {
      trailer: e.MYANYAGENT_ATTRIBUTION.trim(),
      source: "env",
      identity: { name: null, email: null },
    };
  }
  const toml = readToml(tomlPath);
  const identity = toml.sections.identity || {};
  const bot = toml.sections.bot || {};
  if (identity.co_author) {
    return {
      trailer: identity.co_author,
      source: "identity.co_author",
      identity: { name: identity.name || null, email: identity.email || null },
    };
  }
  if (bot.name && bot.email) {
    return {
      trailer: `${bot.name} <${bot.email}>`,
      source: "bot",
      identity: { name: null, email: null },
    };
  }
  return { trailer: null, source: "none", identity: { name: null, email: null } };
}

// Trailer detection: match the trailer block per git-trailer rules — the last
// paragraph of the message consisting of "Key: value" lines. Key comparison is
// case-insensitive; value comparison is exact.
function hasAttributionTrailer(message, trailer) {
  const lines = String(message).replace(/\r\n/g, "\n").split("\n");
  const keyRe = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/;
  for (const line of lines) {
    const m = line.match(keyRe);
    if (m && m[1].toLowerCase() === TRAILER_KEY.toLowerCase() && m[2] === trailer) {
      return true;
    }
  }
  return false;
}

function appendTrailer(message, trailer) {
  const msg = String(message);
  if (hasAttributionTrailer(msg, trailer)) return msg.endsWith("\n") ? msg : msg + "\n";
  const trimmed = msg.replace(/\n*$/, "");
  const lines = trimmed.split("\n");
  // If the last paragraph already looks like a trailer block, append directly.
  const lastLine = lines[lines.length - 1] || "";
  const looksLikeTrailer = /\n\s*\n/.test(trimmed) && /^[A-Za-z-]+:\s*\S/.test(lastLine);
  const separator = looksLikeTrailer ? "" : "\n";
  return `${trimmed}\n${separator}${TRAILER_KEY}: ${trailer}\n`;
}

module.exports = { resolveAttribution, hasAttributionTrailer, appendTrailer, TRAILER_KEY };
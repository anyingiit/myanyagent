"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveAttribution,
  hasAttributionTrailer,
  appendTrailer,
  TRAILER_KEY,
} = require("../lib/attribution.cjs");

function withToml(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attr-"));
  const tomlPath = path.join(dir, ".myanyagent.toml");
  if (content !== null) fs.writeFileSync(tomlPath, content);
  try {
    return fn(tomlPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BOT_TOML = `repository = "o/r"
installation_id = "1"
[bot]
name = "MyAnyAgent[bot]"
email = "312959697+myanyagent[bot]@users.noreply.github.com"
`;

test("TRAILER_KEY is Co-authored-by", () => {
  assert.equal(TRAILER_KEY, "Co-authored-by");
});

test("resolves bot identity from toml", () => {
  withToml(BOT_TOML, (tomlPath) => {
    const r = resolveAttribution({ tomlPath, gitConfigGet: () => "", env: {} });
    assert.equal(r.trailer, "MyAnyAgent[bot] <312959697+myanyagent[bot]@users.noreply.github.com>");
    assert.equal(r.source, "bot");
  });
});

test("identity.co_author wins over bot", () => {
  withToml(BOT_TOML + `[identity]\nname = "human"\nemail = "h@e.co"\nco_author = "OpenCode (Kimi) <noreply@myanyagent.local>"\n`, (tomlPath) => {
    const r = resolveAttribution({ tomlPath, gitConfigGet: () => "", env: {} });
    assert.equal(r.trailer, "OpenCode (Kimi) <noreply@myanyagent.local>");
    assert.equal(r.source, "identity.co_author");
  });
});

test("env var wins over everything", () => {
  withToml(BOT_TOML, (tomlPath) => {
    const r = resolveAttribution({
      tomlPath,
      gitConfigGet: () => "",
      env: { MYANYAGENT_ATTRIBUTION: "Custom Agent <a@b.c>" },
    });
    assert.equal(r.trailer, "Custom Agent <a@b.c>");
    assert.equal(r.source, "env");
  });
});

test("returns null trailer when nothing configured", () => {
  const r = resolveAttribution({ tomlPath: "/nonexistent/.myanyagent.toml", gitConfigGet: () => "", env: {} });
  assert.equal(r.trailer, null);
  assert.equal(r.source, "none");
});

test("hasAttributionTrailer matches case-insensitive key, exact value", () => {
  const trailer = "OpenCode (Kimi) <noreply@myanyagent.local>";
  assert.equal(hasAttributionTrailer(`feat: x\n\nCo-authored-by: ${trailer}\n`, trailer), true);
  assert.equal(hasAttributionTrailer(`feat: x\n\nCo-Authored-By: ${trailer}\n`, trailer), true);
  assert.equal(hasAttributionTrailer(`feat: x\n\nCo-authored-by: Someone Else <x@y.z>\n`, trailer), false);
  assert.equal(hasAttributionTrailer(`feat: x\n\nno trailer here\n`, trailer), false);
});

test("hasAttributionTrailer ignores a Co-authored-by-looking line in body prose", () => {
  const trailer = "Agent <a@b.c>";
  // The trailer-looking line sits mid-paragraph, so it is NOT in the trailer
  // block per git-trailer rules and must not be counted.
  const msg = "feat: x\n\nsome body prose\nCo-authored-by: Agent <a@b.c>\nmore prose\n";
  assert.equal(hasAttributionTrailer(msg, trailer), false);
});

test("hasAttributionTrailer returns false when git is unavailable", () => {
  const trailer = "Agent <a@b.c>";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attr-nogit-"));
  const msg = `feat: x\n\nCo-authored-by: ${trailer}\n`;
  const prevPath = process.env.PATH;
  try {
    process.env.PATH = dir; // no git on PATH -> interpret-trailers cannot run
    assert.equal(hasAttributionTrailer(msg, trailer), false);
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("appendTrailer appends with blank-line separation", () => {
  const trailer = "OpenCode (Kimi) <noreply@myanyagent.local>";
  const out = appendTrailer("feat: x\n", trailer);
  assert.equal(out, `feat: x\n\nCo-authored-by: ${trailer}\n`);
});

test("appendTrailer is idempotent", () => {
  const trailer = "OpenCode (Kimi) <noreply@myanyagent.local>";
  const once = appendTrailer("feat: x\n", trailer);
  assert.equal(appendTrailer(once, trailer), once);
});

test("appendTrailer appends after existing trailers without blank-line duplication", () => {
  const trailer = "OpenCode (Kimi) <noreply@myanyagent.local>";
  const msg = "feat: x\n\nSigned-off-by: Human <h@e.co>\n";
  const out = appendTrailer(msg, trailer);
  assert.equal(out, `feat: x\n\nSigned-off-by: Human <h@e.co>\nCo-authored-by: ${trailer}\n`);
});
/**
 * KEY-GI-1 L1 — prompt profile unit tests (no API).
 */
import assert from "node:assert/strict";

import {
  LIFEGUARD_AGENT_SYSTEM_PROMPT,
  LIFEGUARD_GI1_SYSTEM_PROMPT,
  LIFEGUARD_MAX_CHARS,
  LIFEGUARD_MAX_TOKENS,
  LIFEGUARD_GI1_MAX_CHARS,
  LIFEGUARD_GI1_MAX_TOKENS,
  resolveLifeguardChatProfile,
} from "../server/lifeguardChatCore.js";

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  console.log("key-gi-1-l1-prompt-profile-unit-test");
  let passed = 0;
  let failed = 0;

  const cases = [
    [
      "L1-1 default profile unchanged",
      () => {
        const p = resolveLifeguardChatProfile();
        assert.equal(p.profile, "default");
        assert.equal(p.maxChars, LIFEGUARD_MAX_CHARS);
        assert.equal(p.maxTokens, LIFEGUARD_MAX_TOKENS);
        assert.equal(p.systemPrompt, LIFEGUARD_AGENT_SYSTEM_PROMPT);
      },
    ],
    [
      "L1-2 gi1 profile limits 800~1000 band",
      () => {
        const p = resolveLifeguardChatProfile({ gi1Profile: true });
        assert.equal(p.profile, "gi1");
        assert.equal(p.maxChars, 900);
        assert.equal(p.maxChars, LIFEGUARD_GI1_MAX_CHARS);
        assert.ok(p.maxChars >= 800 && p.maxChars <= 1000);
        assert.equal(p.maxTokens, LIFEGUARD_GI1_MAX_TOKENS);
        assert.equal(p.systemPrompt, LIFEGUARD_GI1_SYSTEM_PROMPT);
      },
    ],
    [
      "L1-3 gi1 prompt forbids insurance push",
      () => {
        assert.match(LIFEGUARD_GI1_SYSTEM_PROMPT, /Do NOT mention insurance/i);
        assert.match(LIFEGUARD_GI1_SYSTEM_PROMPT, /보험 상담도 도와드릴게요/);
        assert.match(LIFEGUARD_GI1_SYSTEM_PROMPT, /internal engines/i);
      },
    ],
    [
      "L1-4 gi1 prompt requires factual natural tone",
      () => {
        assert.match(LIFEGUARD_GI1_SYSTEM_PROMPT, /factual/i);
        assert.match(LIFEGUARD_GI1_SYSTEM_PROMPT, /natural/i);
        assert.match(LIFEGUARD_GI1_SYSTEM_PROMPT, /general knowledge/i);
      },
    ],
    [
      "L1-5 gi1 prompt distinct from default",
      () => {
        assert.notEqual(LIFEGUARD_GI1_SYSTEM_PROMPT, LIFEGUARD_AGENT_SYSTEM_PROMPT);
      },
    ],
  ];

  for (const [name, fn] of cases) {
    if (await runCase(name, fn)) passed += 1;
    else failed += 1;
  }

  console.log(JSON.stringify({ passed, failed, total: cases.length }));
  if (failed > 0) process.exit(1);
}

main();

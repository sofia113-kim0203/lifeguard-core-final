/**
 * P4-UI MASTER — customer home greeting (memory-aware, no platform tone).
 */

const COLONoscopy_MEMORY_RE = /대장\s*내시경|대장\s*선종|선종\s*제거|내시경/;

function collectMemoryText(unifiedState) {
  const chunks = [];
  const facts = unifiedState?.facts ?? unifiedState?.snapshot?.facts ?? [];
  for (const fact of facts) {
    const value = String(fact?.fact_value ?? fact?.value ?? "").trim();
    const key = String(fact?.fact_key ?? fact?.key ?? "").trim();
    if (value) chunks.push(value);
    if (key) chunks.push(key);
  }
  return chunks.join(" ");
}

export function buildLifeguardHomeGreeting(displayName = "고객", unifiedState = null) {
  const name = String(displayName ?? "고객").trim() || "고객";
  const memoryText = collectMemoryText(unifiedState);

  if (COLONoscopy_MEMORY_RE.test(memoryText)) {
    return {
      title: "LIFEGUARD",
      lines: [
        `안녕하세요 ${name}님.`,
        "다시 만나서 반가워요.",
        "지난번 대장내시경 이야기",
        "잘 마무리되셨나요?",
      ],
      hasMemoryHook: true,
    };
  }

  return {
    title: "LIFEGUARD",
    lines: [`안녕하세요 ${name}님.`, "오늘은 무엇을 도와드릴까요?"],
    hasMemoryHook: false,
  };
}

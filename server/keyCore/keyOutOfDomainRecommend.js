/**
 * Out-of-domain (daily/place) recommendation completion guidance for KEY.
 * Not a restaurant engine — prompt/completion rules only.
 * Reuses place-thread continuity from keyBorrowedSensesSpeak.
 */
import { isActivePlaceCustomerThread } from "./keyBorrowedSensesSpeak.js";

function turnText(h = null) {
  return String(h?.text ?? h?.content ?? h?.message ?? "").trim();
}

function threadText({ question = "", history = [] } = {}) {
  const parts = [];
  for (const h of Array.isArray(history) ? history : []) {
    if (String(h?.role ?? "") !== "user") continue;
    const t = turnText(h);
    if (t) parts.push(t);
  }
  const q = String(question ?? "").trim();
  if (q) parts.push(q);
  return parts.join("\n");
}

/** User explicitly asks KEY to stop clarifying and just complete the recommend. */
export function isStopAskingRecommendIntent(question = "") {
  const q = String(question ?? "").trim();
  if (!q) return false;
  if (/그만\s*물어/.test(q)) return true;
  if (/물어보지\s*말|질문\s*그만|추가\s*질문\s*말/.test(q)) return true;
  if (/그냥\s*추천|알아서\s*골|알아서\s*추천/.test(q)) return true;
  if (/소개만\s*(시켜|해|해줘|해주세요)/.test(q)) return true;
  if (/추천만\s*(해|해줘|해주세요)/.test(q)) return true;
  if (/더\s*묻지\s*말|묻지\s*말고/.test(q)) return true;
  return false;
}

/**
 * Soft sufficiency across the open place thread (location / party / time / food·style).
 * Not a hard gate — used only for completion guidance.
 */
export function collectPlaceRecommendSignals({ question = "", history = [] } = {}) {
  const text = threadText({ question, history });
  const location =
    /정자|분당|판교|강남|홍대|이태원|성수|잠실|근처|사거리|역\s*근처|동\b|구\b/.test(text);
  const party = /\d+\s*명|[일이삼사오육칠팔구십]\s*명|둘이|셋이|혼자|가족|회식/.test(text);
  const time = /저녁|점심|아침|브런치|밤|늦은\s*밤|주말|평일|오늘|내일/.test(text);
  const cuisineOrStyle =
    /일식|한식|중식|양식|이자카야|야키토리|스시|오마카세|고깃집|파스타|피자|카페|브런치|술집|바\b|맛집|식당/.test(
      text,
    );
  const score = [location, party, time, cuisineOrStyle].filter(Boolean).length;
  return {
    location,
    party,
    time,
    cuisine_or_style: cuisineOrStyle,
    signal_count: score,
    sufficient: score >= 3,
  };
}

export function hasSufficientPlaceRecommendContext({ question = "", history = [] } = {}) {
  if (!isActivePlaceCustomerThread({ question, history })) return false;
  return collectPlaceRecommendSignals({ question, history }).sufficient === true;
}

/**
 * System addendum when an open place/daily recommend thread should complete.
 * Empty string when not applicable.
 */
export function buildOutOfDomainPlaceRecommendAddendum({
  question = "",
  history = [],
} = {}) {
  const placeOpen = isActivePlaceCustomerThread({ question, history });
  if (!placeOpen) return "";

  const stopAsk = isStopAskingRecommendIntent(question);
  const signals = collectPlaceRecommendSignals({ question, history });
  const completeNow = stopAsk || signals.sufficient;

  const lines = [
    "일상·장소·맛집 추천 스레드가 열려 있다. 보험으로 주제를 바꾸지 않는다.",
    "현재 장소·영업·상호가 필요한 추천은 허용된 공개 검색 도구(web_search)로 확인한 실제 상호만 제시한다.",
    "검색으로 확인되지 않은 가게명·골목·거리·영업시간을 만들지 않는다. '야키토리 골목' 같은 미확인 표현을 쓰지 않는다.",
    "검색 도구가 없거나 실패하면 그 사실만 짧게 말하고 가짜 후보를 만들지 않는다.",
    "고객에게 네이버·카카오 지도에서 직접 검색하라고 떠넘기지 않는다.",
    "핵심 조건(위치·인원·시간·음식·스타일)이 부족할 때만 자연스럽게 한 번 확인할 수 있다.",
  ];

  if (completeNow) {
    lines.push(
      stopAsk
        ? "고객이 추가 질문 중단·소개만·그냥 추천을 요청했다. 추가 질문은 즉시 금지하고 지금 요청을 완수한다."
        : "대화에 위치·인원·시간·음식/스타일 등 핵심 조건이 충분하다. 추가 질문 없이 바로 추천을 완수한다.",
      "가능하면 확인된 실제 가게 최대 3곳을 바로 제시한다. 각 후보에 가게명·대략 위치·대표 메뉴/특징·선택 이유·방문 전 확인할 점을 넣는다.",
      "답변을 추가 질문으로 끝내지 않는다. 필요할 때만 영업시간·예약은 방문 전 확인 안내를 짧게 붙인다.",
    );
  } else {
    lines.push(
      "조건이 아직 부족하면 정말 필요한 것 하나만 자연스럽게 묻고, 조건이 모이거나 고객이 중단을 요청하면 즉시 추천을 완수한다.",
    );
  }

  return lines.join("\n");
}

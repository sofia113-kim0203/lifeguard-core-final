/**
 * Phase 28 — Corporate (법인장) UI shell. No corporate engine; personal data kept separate.
 */
const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const SECTIONS = [
  { key: "basic", title: "법인 기본정보", status: "준비 중" },
  { key: "employees", title: "임직원 보장", status: "연결 예정" },
  { key: "group", title: "단체보험", status: "연결 예정" },
  { key: "tax", title: "세무/재무 리스크", status: "연결 예정" },
  { key: "executive", title: "대표자 보장", status: "연결 예정" },
  { key: "contracts", title: "법인 계약 문서", status: "연결 예정" },
];

const S = {
  wrap: { display: "flex", flexDirection: "column", gap: "24px", fontFamily: FONT },
  hero: {
    background: "linear-gradient(135deg, rgba(30, 64, 175, 0.22) 0%, rgba(15, 23, 42, 0.95) 70%)",
    border: "1px solid rgba(96, 165, 250, 0.28)",
    borderRadius: "20px",
    padding: "32px 36px",
  },
  title: { margin: 0, fontSize: "28px", fontWeight: 700, color: "#f8fafc" },
  desc: { margin: "10px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "640px" },
  notice: {
    padding: "14px 16px",
    borderRadius: "12px",
    background: "rgba(30, 41, 59, 0.55)",
    border: "1px solid rgba(148, 163, 184, 0.15)",
    fontSize: "13px",
    color: "#94a3b8",
    lineHeight: 1.55,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "16px",
  },
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "22px 24px",
  },
  cardTitle: { margin: 0, fontSize: "16px", fontWeight: 700, color: "#e2e8f0" },
  cardBody: { margin: "10px 0 0", fontSize: "13px", color: "#64748b", lineHeight: 1.55 },
  badge: {
    display: "inline-block",
    marginTop: "14px",
    padding: "5px 10px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 700,
    background: "rgba(245, 158, 11, 0.12)",
    border: "1px solid rgba(245, 158, 11, 0.35)",
    color: "#fbbf24",
  },
};

export default function CorporatePanel() {
  return (
    <div style={S.wrap}>
      <section style={S.hero}>
        <h1 style={S.title}>법인장</h1>
        <p style={S.desc}>
          법인·단체 보험, 임직원 보장, 대표자 리스크를 별도 공간에서 관리합니다. 개인 고객 보험
          데이터와 분리된 법인 전용 화면입니다.
        </p>
      </section>

      <div style={S.notice}>
        현재 법인장은 UI 준비 단계입니다. 개인 고객의 AI 상담·추천·설계안 데이터는 이 화면에
        표시되지 않습니다.
      </div>

      <div style={S.grid}>
        {SECTIONS.map((section) => (
          <article key={section.key} style={S.card}>
            <h2 style={S.cardTitle}>{section.title}</h2>
            <p style={S.cardBody}>
              법인 전용 데이터 연결 후 분석·설계 기능이 제공됩니다.
            </p>
            <span style={S.badge}>{section.status}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

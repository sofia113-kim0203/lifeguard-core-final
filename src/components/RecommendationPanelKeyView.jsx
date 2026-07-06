import {
  KEY_PANEL_SECTION_TITLE,
  KEY_RECOMMENDATION_PANEL_LIMITATION,
  buildRecommendationPanelContinuation,
  buildRecommendationPanelItemCaveat,
  buildRecommendationPanelItemLead,
  buildRecommendationPanelItemWhy,
  buildRecommendationPanelNextStep,
  getRecommendationPanelOrderLabel,
} from "../lib/recommendationPanelKeyVoice.js";

export default function RecommendationPanelKeyView({
  loading = false,
  recTop2 = [],
  recKeepExisting = [],
  recResult = null,
  styles: S,
}) {
  const continuation = buildRecommendationPanelContinuation(recTop2);
  const nextStep = buildRecommendationPanelNextStep(recTop2);

  return (
    <div style={S.card}>
      <h3 style={S.sectionTitle}>{KEY_PANEL_SECTION_TITLE}</h3>
      {loading ? (
        <div style={S.muted}>저장된 자료를 KEY 기준으로 정리하는 중…</div>
      ) : recTop2.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              fontSize: "15px",
              lineHeight: 1.65,
              color: "#e2e8f0",
              padding: "12px 14px",
              borderRadius: "10px",
              background: "rgba(30, 41, 59, 0.55)",
              border: "1px solid rgba(148, 163, 184, 0.2)",
            }}
          >
            <div>{continuation}</div>
          </div>

          <ul style={S.list}>
            {recTop2.map((item, index) => {
              const why = buildRecommendationPanelItemWhy(item);
              const caveat = buildRecommendationPanelItemCaveat(item);
              return (
                <li key={item.coverage_category ?? index} style={S.listItem}>
                  <div style={{ marginBottom: "6px" }}>
                    <span
                      style={{
                        ...S.badge,
                        background: "rgba(148, 163, 184, 0.12)",
                        border: "1px solid rgba(148, 163, 184, 0.28)",
                        color: "#cbd5e1",
                      }}
                    >
                      {getRecommendationPanelOrderLabel(index)}
                    </span>
                    <strong style={{ color: "#f1f5f9" }}>{buildRecommendationPanelItemLead(item)}</strong>
                  </div>
                  {why ? <div style={{ ...S.muted, color: "#cbd5e1" }}>{why}</div> : null}
                  {caveat ? (
                    <div style={{ marginTop: "6px", fontSize: "13px", color: "#94a3b8" }}>{caveat}</div>
                  ) : null}
                  {item.required_documents?.length ? (
                    <div style={{ marginTop: "6px", fontSize: "13px", color: "#94a3b8" }}>
                      먼저 준비할 자료: {item.required_documents.join(", ")}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {recKeepExisting.length ? (
            <div>
              <h4 style={S.sectionTitle}>유지하고 볼 축</h4>
              <div style={{ fontSize: "13px", color: "#cbd5e1" }}>
                {recKeepExisting.map((item) => item.coverage_label).join(", ")}
              </div>
            </div>
          ) : null}

          {recResult?.requiredDocuments?.length ? (
            <div>
              <h4 style={S.sectionTitle}>함께 준비할 서류</h4>
              <ul style={S.list}>
                {recResult.requiredDocuments.map((doc) => (
                  <li key={doc} style={S.listItem}>
                    {doc}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div
            style={{
              fontSize: "14px",
              lineHeight: 1.6,
              color: "#94a3b8",
              padding: "10px 12px",
              borderLeft: "3px solid rgba(148, 163, 184, 0.45)",
            }}
          >
            {KEY_RECOMMENDATION_PANEL_LIMITATION}
          </div>

          <div style={{ fontSize: "14px", color: "#cbd5e1", lineHeight: 1.6 }}>{nextStep}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "15px", color: "#e2e8f0", lineHeight: 1.65 }}>{continuation}</div>
          <div style={{ fontSize: "14px", color: "#94a3b8" }}>{KEY_RECOMMENDATION_PANEL_LIMITATION}</div>
          <div style={{ fontSize: "14px", color: "#cbd5e1" }}>{nextStep}</div>
        </div>
      )}
    </div>
  );
}

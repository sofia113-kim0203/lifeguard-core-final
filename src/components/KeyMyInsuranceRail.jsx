/**
 * Left rail — my insurance status (customer card only, no separate API).
 */
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { buildMyInsuranceStatus, formatWonMonthly } from "../lib/keyInsuranceScreenFacts.js";

export default function KeyMyInsuranceRail({ policies = [], loading = false, style = {} }) {
  const status = buildMyInsuranceStatus(policies);

  return (
    <aside
      aria-label="\uB098\uC758 \uBCF4\uD5D8 \uD604\uD669"
      style={{
        width: "260px",
        flexShrink: 0,
        borderRight: `1px solid ${LG.border}`,
        background: LG.sidebarBg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ padding: "16px 16px 10px", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: LG.serif,
            fontSize: "15px",
            fontWeight: 600,
            color: LG.text,
            marginBottom: "10px",
          }}
        >
          {"\uB098\uC758 \uBCF4\uD5D8 \uD604\uD669"}
        </div>
        {loading ? (
          <p style={{ margin: 0, fontSize: "13px", color: LG.textMuted }}>{"\uBD88\uB7EC\uC624\uB294 \uC911\u2026"}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
            <div style={{ color: LG.text }}>
              {"\uD655\uC778\uB41C \uACC4\uC57D"}{" "}
              <strong style={{ color: "#0F766E" }}>{status.confirmedCount}</strong>
              {"\uAC74"}
            </div>
            <div style={{ color: LG.textMuted }}>
              {"\uD655\uC778 \uD544\uC694"}{" "}
              <strong style={{ color: status.needsCount ? "#C2410C" : LG.textMuted }}>
                {status.needsCount}
              </strong>
              {"\uAC74"}
            </div>
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 12px 16px" }}>
        {!loading && status.totalCount === 0 ? (
          <p style={{ margin: "8px 4px", fontSize: "13px", color: LG.textMuted, lineHeight: 1.55 }}>
            {"\uC544\uC9C1 \uD655\uC778\uB41C \uBCF4\uD5D8\uC774 \uC5C6\uC5B4\uC694. \uC11C\uB958\uB97C \uC62C\uB9AC\uBA74 KEY\uAC00 \uD655\uC778\uD569\uB2C8\uB2E4."}
          </p>
        ) : null}
        {status.policies.map((row) => {
          const premium = formatWonMonthly(row.monthly_premium);
          const confirmed = row.status === "\uD655\uC778\uB428";
          return (
            <div
              key={row.id || `${row.insurer_name}-${row.product_name}`}
              style={{
                border: `1px solid ${LG.border}`,
                borderRadius: "10px",
                padding: "12px",
                background: LG.surface,
                marginBottom: "8px",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "14px", color: LG.text, marginBottom: "4px" }}>
                {row.insurer_name ?? "\uBCF4\uD5D8\uC0AC \uBBF8\uD655\uC778"}
              </div>
              {row.product_name ? (
                <div style={{ fontSize: "13px", color: LG.textMuted, marginBottom: "6px" }}>
                  {row.product_name}
                </div>
              ) : null}
              {premium ? (
                <div
                  style={{
                    fontSize: "13px",
                    color: confirmed ? "#0F766E" : LG.textMuted,
                    fontWeight: confirmed ? 600 : 400,
                    marginBottom: "6px",
                  }}
                >
                  {premium}
                </div>
              ) : (
                <div style={{ fontSize: "13px", color: "#C2410C", marginBottom: "6px" }}>
                  {"\uC6D4 \uBCF4\uD5D8\uB8CC \uD655\uC778 \uD544\uC694"}
                </div>
              )}
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: confirmed ? "#0F766E" : "#C2410C",
                }}
              >
                {row.status}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

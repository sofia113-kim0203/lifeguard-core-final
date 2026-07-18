/**
 * Right rail — KEY turn mirror. Same KEY answer only; no separate judgment.
 */
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { KEY_TURN_MIRROR_EMPTY } from "../lib/keyInsuranceScreenFacts.js";

function Section({ title, children, accent }) {
  return (
    <section style={{ marginBottom: "18px" }}>
      <div
        style={{
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: accent || LG.textMuted,
          marginBottom: "8px",
        }}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

export default function KeyTurnMirrorRail({ mirror = null, style = {} }) {
  const empty = !mirror || mirror.empty;
  const emptyMessage = mirror?.emptyMessage || KEY_TURN_MIRROR_EMPTY;

  return (
    <aside
      aria-label="KEY \uD655\uC778 \uB0B4\uC6A9"
      style={{
        width: "280px",
        flexShrink: 0,
        borderLeft: `1px solid ${LG.border}`,
        background: LG.bg,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ padding: "16px 16px 8px", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: LG.serif,
            fontSize: "15px",
            fontWeight: 600,
            color: LG.text,
          }}
        >
          {"KEY\uAC00 \uD655\uC778\uD55C \uB0B4\uC6A9"}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 20px" }}>
        {empty ? (
          <p style={{ margin: "8px 0", fontSize: "13px", color: LG.textMuted, lineHeight: 1.6 }}>
            {emptyMessage}
          </p>
        ) : (
          <>
            {mirror.judgment ? (
              <Section title={"KEY\uC758 \uD310\uB2E8"} accent={LG.text}>
                <p
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    lineHeight: 1.65,
                    color: LG.text,
                    fontWeight: 450,
                  }}
                >
                  {mirror.judgment}
                </p>
              </Section>
            ) : null}

            <Section title={"\uD655\uC778\uB428"} accent="#0F766E">
              {(mirror.confirmed ?? []).length === 0 ? (
                <p style={{ margin: 0, fontSize: "13px", color: LG.textSoft }}>{"\uD574\uB2F9 \uC5C6\uC74C"}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: "18px", color: LG.text, fontSize: "13px", lineHeight: 1.6 }}>
                  {(mirror.confirmed ?? []).map((item) => (
                    <li key={item} style={{ marginBottom: "4px" }}>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={"\uD655\uC778 \uD544\uC694"} accent="#C2410C">
              {(mirror.needsConfirmation ?? []).length === 0 ? (
                <p style={{ margin: 0, fontSize: "13px", color: LG.textSoft }}>{"\uD574\uB2F9 \uC5C6\uC74C"}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: "18px", color: LG.text, fontSize: "13px", lineHeight: 1.6 }}>
                  {(mirror.needsConfirmation ?? []).map((item) => (
                    <li key={item} style={{ marginBottom: "4px" }}>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}

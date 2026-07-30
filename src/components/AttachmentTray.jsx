/**
 * Compact single-tray multi-file attach strip.
 * One tray; files laid out horizontally. Fixed height; overflow-x only.
 */

export const ATTACHMENT_TRAY_HEIGHT_PX = 52;
export const ATTACHMENT_TRAY_THUMB_PX = 32;

/**
 * @param {{
 *   attachments?: Array<{
 *     documentId?: string,
 *     filename?: string,
 *     previewUrl?: string,
 *     mime?: string|null,
 *     isImage?: boolean,
 *   }>,
 *   onRemove?: ((documentId: string) => void) | null,
 *   removable?: boolean,
 *   deletingId?: string|null,
 *   deleteLabel?: string,
 *   mutedColor?: string,
 *   textColor?: string,
 *   borderColor?: string,
 *   surfaceColor?: string,
 *   fontFamily?: string,
 *   style?: object,
 * }} props
 */
export default function AttachmentTray({
  attachments = [],
  onRemove = null,
  removable = false,
  deletingId = null,
  deleteLabel = "삭제",
  mutedColor = "#6B7280",
  textColor = "#111827",
  borderColor = "#E5E7EB",
  surfaceColor = "#FFFFFF",
  fontFamily,
  style = null,
}) {
  const rows = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (rows.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="첨부 파일"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "8px",
        height: `${ATTACHMENT_TRAY_HEIGHT_PX}px`,
        maxHeight: `${ATTACHMENT_TRAY_HEIGHT_PX}px`,
        minHeight: `${ATTACHMENT_TRAY_HEIGHT_PX}px`,
        padding: "0 4px",
        marginBottom: "8px",
        overflowX: "auto",
        overflowY: "hidden",
        boxSizing: "border-box",
        border: `1px solid ${borderColor}`,
        borderRadius: "12px",
        background: surfaceColor,
        ...(style && typeof style === "object" ? style : {}),
      }}
    >
      {rows.map((row) => {
        const did = String(row?.documentId ?? "").trim();
        const filename = String(row?.filename ?? "파일").trim() || "파일";
        const previewUrl = String(row?.previewUrl ?? "").trim();
        const showImage = row?.isImage === true && Boolean(previewUrl);
        const isDeleting = Boolean(deletingId) && deletingId === did;
        return (
          <div
            key={did || filename}
            style={{
              display: "inline-flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "6px",
              flex: "0 0 auto",
              maxWidth: "180px",
              minWidth: 0,
              height: `${ATTACHMENT_TRAY_THUMB_PX + 8}px`,
              padding: "0 6px",
              borderRadius: "8px",
              border: `1px solid ${borderColor}`,
              background: surfaceColor,
              boxSizing: "border-box",
            }}
          >
            {showImage ? (
              <img
                src={previewUrl}
                alt=""
                style={{
                  width: `${ATTACHMENT_TRAY_THUMB_PX}px`,
                  height: `${ATTACHMENT_TRAY_THUMB_PX}px`,
                  objectFit: "cover",
                  borderRadius: "4px",
                  flexShrink: 0,
                  background: surfaceColor,
                }}
              />
            ) : (
              <span
                aria-hidden="true"
                style={{
                  width: `${ATTACHMENT_TRAY_THUMB_PX}px`,
                  height: `${ATTACHMENT_TRAY_THUMB_PX}px`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: "14px",
                  color: mutedColor,
                }}
              >
                📄
              </span>
            )}
            <span
              title={filename}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "12px",
                color: textColor,
                fontFamily,
                minWidth: 0,
              }}
            >
              {filename}
            </span>
            {removable && typeof onRemove === "function" && did ? (
              <button
                type="button"
                aria-label={`${deleteLabel}: ${filename}`}
                disabled={Boolean(deletingId)}
                onClick={() => {
                  onRemove(did);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isDeleting ? mutedColor : "#B91C1C",
                  cursor: deletingId ? "default" : "pointer",
                  fontSize: "12px",
                  fontFamily,
                  flexShrink: 0,
                  padding: "0 2px",
                  lineHeight: 1,
                }}
              >
                {isDeleting ? "…" : "🗑"}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

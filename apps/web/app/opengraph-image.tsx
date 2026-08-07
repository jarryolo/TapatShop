import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "TapatShop — honest goods from the brotherhood";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The default link preview.
 *
 * Drawn rather than served from a file, for two reasons: there is no media pipeline yet
 * (P1-06 is blocked), and a generated image cannot go stale against the design tokens the way
 * an exported PNG does. Colours are the literal token values — this runs in a separate
 * rendering context with no stylesheet, so they cannot be referenced by name.
 */
export default async function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "linear-gradient(135deg, #1F4D3A 0%, #143529 100%)",
        color: "#FFFFFF",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2 }}>TapatShop</div>
      <div style={{ marginTop: 20, fontSize: 36, opacity: 0.85, maxWidth: 900 }}>
        Honest goods from the brotherhood
      </div>
      <div style={{ marginTop: 48, fontSize: 26, opacity: 0.7 }}>
        Clear prices · No fake urgency
      </div>
    </div>,
    size
  );
}

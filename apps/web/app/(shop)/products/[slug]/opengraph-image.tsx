import { ImageResponse } from "next/og";

import { db } from "@/lib/db";
import { formatPeso } from "@/lib/utils/money";

export const runtime = "nodejs";
export const alt = "Product on TapatShop";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * A per-product link preview: name, brand, and the price actually advertised.
 *
 * The **regular** price, never the member price — the same rule the structured data follows.
 * A shared link is seen by whoever it is forwarded to, and most of them are not members.
 *
 * Reads the database directly rather than through getProductDetail: this needs three columns
 * and that function fetches reviews, ratings and every variant.
 */
export default async function ProductOpengraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const product = await db.product.findFirst({
    where: { slug, status: "active" },
    select: {
      name: true,
      brand: true,
      variants: {
        where: { isActive: true },
        select: { priceCents: true },
        orderBy: { priceCents: "asc" },
      },
    },
  });

  const cheapest = product?.variants[0]?.priceCents;
  const many = (product?.variants.length ?? 0) > 1;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#FBFAF8",
        color: "#1A1A19",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        {product?.brand ? (
          <div style={{ fontSize: 28, color: "#6B6B66" }}>{product.brand}</div>
        ) : null}
        <div
          style={{
            marginTop: 12,
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: -1.5,
            lineHeight: 1.1,
            // Long names would otherwise run off the canvas; ImageResponse does not clip.
            maxWidth: 1000,
          }}
        >
          {(product?.name ?? "TapatShop").slice(0, 80)}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ fontSize: 48, fontWeight: 700, color: "#1F4D3A" }}>
          {cheapest === undefined ? "" : `${many ? "From " : ""}${formatPeso(cheapest)}`}
        </div>
        <div style={{ fontSize: 30, color: "#6B6B66" }}>TapatShop</div>
      </div>
    </div>,
    size
  );
}

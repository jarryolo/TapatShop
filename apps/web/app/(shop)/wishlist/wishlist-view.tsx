"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatPeso } from "@/lib/utils/money";

export interface WishlistRow {
  id: string;
  productId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  imageAlt: string;
  priceCents: number;
  memberPriceCents: number;
  inStock: boolean;
  available: boolean;
}

export function WishlistView({ rows, isMember }: { rows: WishlistRow[]; isMember: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  async function remove(row: WishlistRow) {
    setPending(row.productId);
    const response = await fetch("/api/v1/me/wishlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: row.productId }),
    });
    setPending(null);

    if (!response.ok) {
      toast("Could not remove that.", "error");
      return;
    }

    toast(`${row.name} removed.`, "success");
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing saved yet"
        body="Save something you are thinking about and it will be here next time."
        action={
          <Link href="/products" className="font-semibold text-brand-600 hover:underline">
            Browse products
          </Link>
        }
      />
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-4 py-4">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.imageUrl}
              alt={row.imageAlt}
              className="size-20 shrink-0 rounded-[var(--radius-card)] object-cover"
            />
          ) : (
            <div className="size-20 shrink-0 rounded-[var(--radius-card)] bg-surface-sunken" />
          )}

          <div className="min-w-0 flex-1">
            <Link href={`/products/${row.slug}`} className="font-semibold hover:text-brand-600">
              {row.name}
            </Link>
            <p className="mt-0.5 tabular-nums">
              {isMember && row.memberPriceCents < row.priceCents ? (
                <>
                  <span className="font-semibold">{formatPeso(row.memberPriceCents)}</span>{" "}
                  <span className="text-[13px] text-text-muted line-through">
                    {formatPeso(row.priceCents)}
                  </span>
                </>
              ) : (
                <span className="font-semibold">{formatPeso(row.priceCents)}</span>
              )}
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              {/* Kept and marked rather than removed. A saved item silently vanishing looks
                  like the site lost it. */}
              {!row.available ? (
                <Badge tone="neutral">No longer sold</Badge>
              ) : row.inStock ? null : (
                <Badge tone="warning">Out of stock</Badge>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {row.available ? (
              <Link
                href={`/products/${row.slug}`}
                className="rounded-[var(--radius-ctrl)] bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                {row.inStock ? "View" : "Notify me"}
              </Link>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              loading={pending === row.productId}
              onClick={() => remove(row)}
            >
              Remove
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

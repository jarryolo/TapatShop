import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { listProductsForAdmin } from "@/lib/services/product.service";

import { ProductsTable, type ProductRow } from "./products-table";

export const metadata: Metadata = { title: "Products — TapatShop admin" };

// Admin pages read live data on every request. docs/02: never cached.
export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const products = await listProductsForAdmin();

  const rows: ProductRow[] = products.map((product) => {
    const active = product.variants.filter((v) => v.isActive);
    const prices = active.map((v) => v.priceCents);

    return {
      id: product.id,
      name: product.name,
      brand: product.brand ?? "—",
      category: product.category?.name ?? "Uncategorised",
      status: product.status,
      variantCount: active.length,
      // The lowest active price, which is what a "from ₱x" label would show.
      priceCents: prices.length > 0 ? Math.min(...prices) : 0,
      stockQty: active.reduce((sum, v) => sum + v.stockQty, 0),
      hasImage: product.images.length > 0,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Products</h1>
          <p className="mt-1 text-sm text-text-muted">
            {rows.length} {rows.length === 1 ? "product" : "products"}. Draft products are not
            visible in the storefront.
          </p>
        </div>
        <ButtonLink href="/admin/products/new">New product</ButtonLink>
      </header>

      <ProductsTable rows={rows} />
    </div>
  );
}

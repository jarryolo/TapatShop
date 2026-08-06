import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { db } from "@/lib/db";
import { getProductForAdmin, publishBlockers } from "@/lib/services/product.service";

import { ProductEditor } from "./product-editor";

export const metadata: Metadata = { title: "Edit product — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [product, categories, blockers] = await Promise.all([
    getProductForAdmin(id),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    publishBlockers(db, id),
  ]);

  if (!product) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[{ label: "Products", href: "/admin/products" }, { label: product.name }]}
      />

      <ProductEditor
        product={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          brand: product.brand,
          description: product.description,
          status: product.status,
          categoryId: product.categoryId,
          isFeatured: product.isFeatured,
          memberOnly: product.memberOnly,
          variants: product.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            name: v.name,
            priceCents: v.priceCents,
            compareAtPriceCents: v.compareAtPriceCents,
            stockQty: v.stockQty,
            weightGrams: v.weightGrams,
            isActive: v.isActive,
          })),
          images: product.images.map((i) => ({
            id: i.id,
            url: i.url,
            alt: i.alt,
          })),
        }}
        categories={categories}
        initialBlockers={blockers}
      />
    </div>
  );
}

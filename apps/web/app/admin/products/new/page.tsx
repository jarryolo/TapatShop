import type { Metadata } from "next";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";

import { NewProductForm } from "./new-product-form";

export const metadata: Metadata = { title: "New product — TapatShop admin" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[{ label: "Products", href: "/admin/products" }, { label: "New product" }]}
      />

      <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">New product</h1>

      <Card className="max-w-2xl">
        <p className="mb-4 text-sm text-text-muted">
          Products start as drafts. Add variants and an image, then publish when it is ready.
        </p>
        <NewProductForm categories={categories} />
      </Card>
    </div>
  );
}

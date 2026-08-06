import { enforceRateLimit, ok } from "@/lib/api/respond";
import { listCategories } from "@/lib/services/catalog.service";

/** The category tree, nested — docs/04. Only categories with a live product are returned. */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const flat = await listCategories();

  const children = new Map<string, typeof flat>();
  for (const category of flat) {
    if (!category.parentId) continue;
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category);
    children.set(category.parentId, siblings);
  }

  const tree = flat
    .filter((category) => !category.parentId)
    .map((category) => ({
      ...category,
      productCount: category._count.products,
      children: (children.get(category.id) ?? []).map((child) => ({
        ...child,
        productCount: child._count.products,
      })),
    }));

  return ok({ data: tree });
}

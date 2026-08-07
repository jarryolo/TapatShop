import { auditActor, requireStaff } from "@/lib/api/guard";
import { failValidation, ok, readJson } from "@/lib/api/respond";
import { db } from "@/lib/db";
import { productService } from "@/lib/services/product.service";
import { categoryInputSchema } from "@/lib/validators/product";

export async function GET(request: Request) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const categories = await db.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });

  return ok({ data: categories });
}

export async function POST(request: Request) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const parsed = categoryInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const category = await productService.createCategory(
    auditActor(guard.actor, request),
    parsed.data
  );
  return ok({ data: category }, 201);
}

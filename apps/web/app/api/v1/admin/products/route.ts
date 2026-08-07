import { auditActor, requireStaff } from "@/lib/api/guard";
import { failValidation, ok, readJson } from "@/lib/api/respond";
import { listProductsForAdmin, productService } from "@/lib/services/product.service";
import { productInputSchema } from "@/lib/validators/product";

export async function GET(request: Request) {
  // Re-checked here, not just in middleware. docs/02: middleware is a convenience.
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const products = await listProductsForAdmin();
  return ok({ data: products });
}

export async function POST(request: Request) {
  const guard = await requireStaff(request);
  if (!guard.ok) return guard.response;

  const parsed = productInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const product = await productService.create(auditActor(guard.actor, request), parsed.data);
  return ok({ data: product }, 201);
}

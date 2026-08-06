import { enforceRateLimit, fail, ok } from "@/lib/api/respond";
import { auth } from "@/lib/auth";
import {
  getProductDetail,
  memberDiscountPercent,
  relatedProducts,
} from "@/lib/services/catalog.service";

/** Four items from the same category — docs/04. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const { slug } = await context.params;
  const session = await auth();
  const isMember = Boolean(session?.user?.isMember && session.user.emailIsVerified);
  const percent = isMember ? await memberDiscountPercent() : 0;

  const product = await getProductDetail(slug);
  if (!product) return fail("NOT_FOUND", "That product does not exist.");

  const related = await relatedProducts(product.id, product.category?.slug ?? null, percent);
  return ok({ data: related });
}

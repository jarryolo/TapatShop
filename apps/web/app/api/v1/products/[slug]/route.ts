import { enforceRateLimit, fail, ok } from "@/lib/api/respond";
import { auth } from "@/lib/auth";
import { getProductDetail, memberDiscountPercent } from "@/lib/services/catalog.service";

/** Full detail with variants, images and approved reviews — docs/04. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const { slug } = await context.params;

  // Member pricing comes from the session, never from a query parameter.
  const session = await auth();
  const isMember = Boolean(session?.user?.isMember && session.user.emailIsVerified);
  const percent = isMember ? await memberDiscountPercent() : 0;

  const product = await getProductDetail(slug, percent);
  if (!product) return fail("NOT_FOUND", "That product does not exist.");

  return ok({ data: product });
}

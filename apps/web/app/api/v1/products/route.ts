import { enforceRateLimit, failValidation, ok } from "@/lib/api/respond";
import { auth } from "@/lib/auth";
import { listCatalog, memberDiscountPercent } from "@/lib/services/catalog.service";
import { catalogQuerySchema } from "@/lib/validators/catalog";

/**
 * The public catalog. The mobile app consumes this too — docs/04.
 *
 * Member pricing is decided here from the session, never from a client-supplied flag. A
 * request that could ask for member prices would be a discount anyone can claim.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = catalogQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return failValidation(parsed.error);

  const session = await auth();
  const isMember = Boolean(session?.user?.isMember && session.user.emailIsVerified);
  const percent = isMember ? await memberDiscountPercent() : 0;

  const page = await listCatalog(
    {
      categorySlug: parsed.data.category,
      q: parsed.data.q,
      minPriceCents: parsed.data.minPrice,
      maxPriceCents: parsed.data.maxPrice,
      inStockOnly: parsed.data.inStock,
      sort: parsed.data.sort,
      page: parsed.data.page,
      limit: parsed.data.limit,
    },
    percent
  );

  return ok(page);
}

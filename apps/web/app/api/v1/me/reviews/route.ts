import { z } from "zod";

import { requireUser } from "@/lib/api/guard";
import { enforceRateLimit, fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { reviewService } from "@/lib/services/review.service";

const bodySchema = z.object({
  productId: z.string().cuid(),
  rating: z.number().int().min(1, "Pick a rating.").max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(4000).optional(),
});

/**
 * Leaves a review — docs/04 `POST /me/reviews`.
 *
 * Every rule that decides whether this is allowed lives in the service, so this handler cannot
 * accidentally permit something by forgetting a check. It never publishes: the response says
 * the review is waiting, because it is.
 */
export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const limited = await enforceRateLimit(request, "default");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const result = await reviewService.submit({ ...parsed.data, userId: guard.actor.id });

  switch (result.kind) {
    case "invalid_rating":
      return fail("VALIDATION_ERROR", "Ratings run from one to five stars.");
    case "email_unverified":
      // docs/07: verification is required to review, but not to check out.
      return fail("FORBIDDEN", "Verify your email address before leaving a review.");
    case "not_purchased":
      return fail("FORBIDDEN", "Reviews are for people who have bought the product.");
    case "already_reviewed":
      return fail("VALIDATION_ERROR", "You have already reviewed this product.");
    case "ok":
      return ok(
        {
          ok: true,
          message: "Thank you. Your review will appear once someone has read it.",
        },
        201
      );
  }
}

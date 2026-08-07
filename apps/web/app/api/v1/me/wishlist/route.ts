import { z } from "zod";

import { requireUser } from "@/lib/api/guard";
import { fail, failValidation, ok, readJson } from "@/lib/api/respond";
import { memberDiscountPercent } from "@/lib/services/catalog.service";
import { wishlistService } from "@/lib/services/wishlist.service";

const bodySchema = z.object({ productId: z.string().cuid() });

/** docs/04: GET / POST / DELETE `/me/wishlist`. Signed in only — a wishlist belongs to someone. */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const percent = guard.actor.isMember ? await memberDiscountPercent() : 0;

  return ok({ data: await wishlistService.list(guard.actor.id, percent) });
}

export async function POST(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const result = await wishlistService.add(guard.actor.id, parsed.data.productId);
  if (result.kind === "not_found") return fail("NOT_FOUND", "That product does not exist.");

  return ok({ ok: true });
}

export async function DELETE(request: Request) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  // Removing something already gone is success, so there is no not-found branch here.
  await wishlistService.remove(guard.actor.id, parsed.data.productId);

  return ok({ ok: true });
}

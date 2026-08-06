import { auditActor, requireStaff } from "@/lib/api/guard";
import { failValidation, ok, readJson } from "@/lib/api/respond";
import { contentService } from "@/lib/services/content.service";
import { bannerInputSchema } from "@/lib/validators/content";

export async function GET() {
  // Re-checked here, not just in middleware. docs/02: middleware is a convenience.
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  return ok({ data: await contentService.list() });
}

export async function POST(request: Request) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  const parsed = bannerInputSchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  const actor = auditActor(guard.actor, request);
  const banner = await contentService.create(parsed.data, { ...actor, id: actor.id });

  return ok({ data: { id: banner.id } }, 201);
}

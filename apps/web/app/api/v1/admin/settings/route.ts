import { requireAdmin } from "@/lib/api/guard";
import { ok } from "@/lib/api/respond";
import { settingsService } from "@/lib/services/settings.service";

/** Every declared setting with its value — except secrets, which come back as `isSet` only. */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  return ok({ data: await settingsService.list() });
}

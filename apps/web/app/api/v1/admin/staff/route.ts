import { requireAdmin } from "@/lib/api/guard";
import { ok } from "@/lib/api/respond";
import { staffService } from "@/lib/services/staff.service";

/**
 * Everyone with admin-portal access, or one account looked up by exact email.
 *
 * Admin-only rather than staff-visible: the roster is who can reach the store's money and
 * customer data, and docs/01 puts staff management on the admin side of that line.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const email = new URL(request.url).searchParams.get("email");
  if (email) {
    const found = await staffService.findByEmail(email);
    // No account is a normal answer here — an admin mistypes an address — so it is an empty
    // result rather than an error.
    return ok({ data: found ? [found] : [] });
  }

  return ok({ data: await staffService.list() });
}

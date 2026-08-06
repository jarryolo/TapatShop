import { requireUser } from "@/lib/api/guard";
import { ok } from "@/lib/api/respond";
import { authService } from "@/lib/services/auth.service";

/** Which sign-in methods the signed-in account has. Authed — docs/04. */
export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const methods = await authService.signInMethodsFor(guard.actor.id);
  return ok(methods);
}

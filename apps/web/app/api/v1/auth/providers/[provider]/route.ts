import { requireUser } from "@/lib/api/guard";
import { fail, ok } from "@/lib/api/respond";
import { authService } from "@/lib/services/auth.service";

/**
 * Unlinks a provider. Refuses if it would leave the account with no way in — docs/07.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const { provider } = await context.params;
  const result = await authService.unlinkProvider(guard.actor.id, provider);

  switch (result.kind) {
    case "not-linked":
      return fail("NOT_FOUND", "That sign-in method is not linked to your account.");

    case "would-lock-out":
      return fail(
        "FORBIDDEN",
        "That is your only way to sign in. Set a password first, then remove it."
      );

    case "ok":
      return ok({ ok: true });
  }
}

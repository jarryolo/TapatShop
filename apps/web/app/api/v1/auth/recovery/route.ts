import { z } from "zod";

import { enforceRateLimit, failValidation, ok, readJson } from "@/lib/api/respond";
import { customerService } from "@/lib/services/customer.service";

const bodySchema = z.object({
  claimedName: z.string().trim().min(1, "Enter your name.").max(120),
  claimedEmail: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  claimedMemberNo: z.string().trim().max(40).optional(),
  claimedOrderNo: z.string().trim().max(40).optional(),
  claimedAddress: z.string().trim().max(300).optional(),
  newEmail: z.string().trim().toLowerCase().email("Enter the email you can access now."),
});

/**
 * The public recovery form â€” docs/07 route 3, step 1.
 *
 * For someone who has lost the email account their login depends on, so it cannot require
 * them to receive anything at the old address.
 *
 * Always answers the same way. Confirming whether a member number or order matches would make
 * this an oracle for exactly the details an impostor is trying to guess.
 */
const SAME_ANSWER = {
  ok: true,
  message:
    "Your request has been received. An admin will check it against your order history and email you at the address you gave.",
};

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "accountRecovery");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return failValidation(parsed.error);

  try {
    await customerService.fileRecovery({
      claimedName: parsed.data.claimedName,
      claimedEmail: parsed.data.claimedEmail || null,
      claimedMemberNo: parsed.data.claimedMemberNo || null,
      claimedOrderNo: parsed.data.claimedOrderNo || null,
      claimedAddress: parsed.data.claimedAddress || null,
      newEmail: parsed.data.newEmail,
    });
  } catch (error) {
    // Same answer even on failure, or the error itself becomes the signal.
    console.error("[recovery] could not file request", error);
  }

  return ok(SAME_ANSWER);
}

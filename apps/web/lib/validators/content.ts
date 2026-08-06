import { z } from "zod";

import { PLACEMENTS } from "@/lib/services/content.service";

/** Admin banner payloads. Validated at the route boundary — docs/CLAUDE.md. */

/**
 * Images live in S3-compatible storage, never in the database or the repo — docs/CLAUDE.md.
 *
 * A relative path here would mean someone had put a file in `public/`, which is the thing
 * that rule exists to stop, so only absolute URLs are accepted.
 */
const imageUrl = z
  .string()
  .trim()
  .url("Paste the full image URL, starting with https://")
  .max(2000);

export const bannerInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the banner a title.").max(200),
    subtitle: z.string().trim().max(300).nullish(),
    imageUrl,
    linkUrl: z.string().trim().max(2000).nullish(),
    placement: z.enum(PLACEMENTS),
    sortOrder: z.number().int().min(0).max(999).default(0),
    isActive: z.boolean().default(true),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "The end has to come after the start.",
      });
    }
  });

export const bannerPatchSchema = bannerInputSchema;

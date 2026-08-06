import { enforceRateLimit, ok } from "@/lib/api/respond";
import { suggest } from "@/lib/services/search.service";

/**
 * Autocomplete. `?q=` — max 8 results with name, image and price. docs/04.
 *
 * Rate limited to 30/min, which is the docs/04 number and is deliberately generous: this
 * fires as someone types, so a limit tuned like a login limit would cut off a customer
 * mid-word.
 */
export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "searchSuggest");
  if (limited) return limited;

  const term = new URL(request.url).searchParams.get("q") ?? "";

  // One character cannot say anything useful and would match most of the catalog.
  if (term.trim().length < 2) return ok({ data: [], tier: "none" });

  const { results, tier } = await suggest(term);
  return ok({ data: results, tier });
}

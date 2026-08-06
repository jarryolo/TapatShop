import { Prisma } from "@tapatshop/db";

import { db } from "@/lib/db";

/**
 * Product search.
 *
 * MySQL FULLTEXT over (name, brand, description) — the index docs/03 specifies. Three tiers,
 * each only reached when the one before it finds nothing:
 *
 *   1. FULLTEXT in boolean mode with a prefix wildcard. Uses the index. Handles "bara" for
 *      "Barako" and ranks by relevance.
 *   2. LIKE. InnoDB will not index tokens shorter than innodb_ft_min_token_size (3 by
 *      default), so "PH" or a two-letter brand is invisible to tier 1 no matter what.
 *   3. Edit distance over product names. This is what turns "barrako" into the coffee
 *      instead of an empty page. It scans names in memory, so it runs last, only when
 *      nothing else matched, and it inherits the ~10k product ceiling docs/03 already sets
 *      for FULLTEXT before recommending a read-side index like Meilisearch.
 */

export type SearchTier = "fulltext" | "like" | "fuzzy" | "none";

export interface SearchOutcome {
  productIds: string[];
  tier: SearchTier;
  /** Set when a fuzzy match changed the effective query, so the UI can say so honestly. */
  correctedTo?: string;
}

/** InnoDB will not index anything shorter than this, so tier 1 cannot see it. */
const MIN_TOKEN = 3;
const MAX_TERM_LENGTH = 100;

/**
 * Strips the boolean operators MySQL would otherwise interpret.
 *
 * A customer typing "polo (navy)" or "t-shirt +" must not produce a syntax error from the
 * database. Everything that is not a letter, digit or space becomes a space.
 */
function tokenize(term: string): string[] {
  return term
    .slice(0, MAX_TERM_LENGTH)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((token) => token.length > 0);
}

/**
 * Builds the boolean-mode expression.
 *
 * Each long-enough token is required and gets a trailing wildcard, so "bara cof" matches
 * "Barako coffee". Short tokens are dropped rather than included — including them would make
 * the whole boolean expression match nothing, since the index has never seen them.
 */
function booleanQuery(tokens: string[]): string | null {
  const usable = tokens.filter((token) => token.length >= MIN_TOKEN);
  if (usable.length === 0) return null;
  return usable.map((token) => `+${token}*`).join(" ");
}

async function fulltextIds(expression: string, limit: number): Promise<string[]> {
  /**
   * Raw SQL, justified per docs/03: Prisma has no way to express MATCH ... AGAINST in
   * boolean mode, and relevance ordering is the entire point of using FULLTEXT rather than
   * LIKE. The column list must match the index definition exactly or MySQL refuses it.
   *
   * The expression is parameterised, so the tokenizer above is defence in depth rather than
   * the only thing standing between a customer's typing and the query.
   */
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM products
    WHERE status = 'active'
      AND MATCH(name, brand, description) AGAINST (${expression} IN BOOLEAN MODE)
      AND EXISTS (
        SELECT 1 FROM product_variants v
        WHERE v.productId = products.id AND v.isActive = 1
      )
    ORDER BY MATCH(name, brand, description) AGAINST (${expression} IN BOOLEAN MODE) DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => row.id);
}

async function likeIds(tokens: string[], limit: number): Promise<string[]> {
  const rows = await db.product.findMany({
    where: {
      status: "active",
      variants: { some: { isActive: true } },
      AND: tokens.map((token) => ({
        OR: [{ name: { contains: token } }, { brand: { contains: token } }],
      })),
    },
    select: { id: true },
    take: limit,
  });

  return rows.map((row) => row.id);
}

/** Levenshtein distance, bailing out once it cannot beat `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }

    // Every value in this row already exceeds the budget, so no later row can come back.
    if (rowMin > max) return max + 1;
    previous = current;
  }

  return previous[b.length] ?? max + 1;
}

/**
 * Last resort: the closest product name, if one is close enough to be plausible.
 *
 * The tolerance scales with word length — one edit for a short word, two for a long one — so
 * "mug" does not quietly become "rug" while "barrako" still finds "Barako".
 */
async function fuzzyIds(
  tokens: string[],
  limit: number
): Promise<{ ids: string[]; correctedTo?: string }> {
  const candidates = await db.product.findMany({
    where: { status: "active", variants: { some: { isActive: true } } },
    select: { id: true, name: true, brand: true },
  });

  const scored: { id: string; distance: number; matched: string }[] = [];

  for (const candidate of candidates) {
    const words = `${candidate.name} ${candidate.brand ?? ""}`
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter(Boolean);

    let best = Number.POSITIVE_INFINITY;
    let bestWord = "";

    for (const token of tokens) {
      const budget = token.length <= 4 ? 1 : 2;
      for (const word of words) {
        const distance = editDistance(token, word, budget);
        if (distance <= budget && distance < best) {
          best = distance;
          bestWord = word;
        }
      }
    }

    if (best !== Number.POSITIVE_INFINITY) {
      scored.push({ id: candidate.id, distance: best, matched: bestWord });
    }
  }

  scored.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));

  return {
    ids: scored.slice(0, limit).map((row) => row.id),
    correctedTo: scored[0]?.matched,
  };
}

/** Runs the tiers in order and reports which one answered. */
export async function searchProductIds(term: string, limit = 24): Promise<SearchOutcome> {
  const tokens = tokenize(term);
  if (tokens.length === 0) return { productIds: [], tier: "none" };

  const expression = booleanQuery(tokens);

  if (expression) {
    const ids = await fulltextIds(expression, limit);
    if (ids.length > 0) return { productIds: ids, tier: "fulltext" };
  }

  const like = await likeIds(tokens, limit);
  if (like.length > 0) return { productIds: like, tier: "like" };

  const fuzzy = await fuzzyIds(tokens, limit);
  if (fuzzy.ids.length > 0) {
    return { productIds: fuzzy.ids, tier: "fuzzy", correctedTo: fuzzy.correctedTo };
  }

  return { productIds: [], tier: "none" };
}

export interface Suggestion {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  imageUrl: string | null;
  priceCents: number;
}

/**
 * Autocomplete. Max 8 results with name, image and price — docs/04.
 *
 * Two queries whatever the tier: the id lookup, then one hydration. Never one per row.
 */
export async function suggest(term: string): Promise<{ results: Suggestion[]; tier: SearchTier }> {
  const outcome = await searchProductIds(term, 8);
  if (outcome.productIds.length === 0) return { results: [], tier: outcome.tier };

  const rows = await db.product.findMany({
    where: { id: { in: outcome.productIds } },
    select: {
      id: true,
      name: true,
      slug: true,
      brand: true,
      images: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
      variants: { where: { isActive: true }, select: { priceCents: true } },
    },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));

  // Reapplies the relevance order, which findMany does not preserve.
  const results = outcome.productIds
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      brand: row.brand,
      imageUrl: row.images[0]?.url ?? null,
      priceCents: row.variants.length > 0 ? Math.min(...row.variants.map((v) => v.priceCents)) : 0,
    }));

  return { results, tier: outcome.tier };
}

/** Exposed for the catalog page, which needs ids it can combine with its own filters. */
export { tokenize as tokenizeSearchTerm, booleanQuery as buildBooleanQuery };

/** Guards against an empty IN () clause, which is a MySQL syntax error. */
export function idFilter(ids: string[]): Prisma.ProductWhereInput {
  return ids.length > 0 ? { id: { in: ids } } : { id: { in: ["__no_match__"] } };
}

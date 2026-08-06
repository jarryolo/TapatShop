import { describe, expect, it } from "vitest";

import { buildBooleanQuery, editDistance, tokenizeSearchTerm } from "./search.service";

describe("tokenizeSearchTerm", () => {
  it("splits on whitespace and lowercases", () => {
    expect(tokenizeSearchTerm("Barako Coffee")).toEqual(["barako", "coffee"]);
  });

  it("strips the boolean operators MySQL would otherwise interpret", () => {
    // "polo (navy)" or a stray + must not reach AGAINST as syntax.
    expect(tokenizeSearchTerm("polo (navy)")).toEqual(["polo", "navy"]);
    expect(tokenizeSearchTerm("+t-shirt -red")).toEqual(["t", "shirt", "red"]);
    expect(tokenizeSearchTerm('"quoted" @user ~tilde')).toEqual(["quoted", "user", "tilde"]);
  });

  it("keeps accented and non-latin characters", () => {
    expect(tokenizeSearchTerm("Café")).toEqual(["café"]);
  });

  it("returns nothing for punctuation alone", () => {
    expect(tokenizeSearchTerm("!!! ???")).toEqual([]);
    expect(tokenizeSearchTerm("   ")).toEqual([]);
  });

  it("bounds absurdly long input", () => {
    const tokens = tokenizeSearchTerm("a".repeat(500));
    expect(tokens[0]?.length).toBeLessThanOrEqual(100);
  });
});

describe("buildBooleanQuery", () => {
  it("requires every token and adds a prefix wildcard", () => {
    expect(buildBooleanQuery(["barako", "coffee"])).toBe("+barako* +coffee*");
  });

  it("drops tokens shorter than the index minimum", () => {
    // InnoDB never indexed them, so including them would make the whole expression
    // match nothing at all.
    expect(buildBooleanQuery(["a", "polo"])).toBe("+polo*");
  });

  it("returns null when every token is too short, so the caller can fall back", () => {
    expect(buildBooleanQuery(["a", "of"])).toBeNull();
  });
});

describe("editDistance", () => {
  it("is zero for identical strings", () => {
    expect(editDistance("barako", "barako")).toBe(0);
  });

  it("counts a single substitution, insertion and deletion", () => {
    expect(editDistance("barako", "barrko")).toBe(1);
    expect(editDistance("barako", "barrako")).toBe(1);
    expect(editDistance("barako", "barak")).toBe(1);
  });

  it("catches the misspelling the fuzzy tier exists for", () => {
    expect(editDistance("barrako", "barako")).toBeLessThanOrEqual(2);
  });

  it("bails out past the budget rather than computing an exact large distance", () => {
    const result = editDistance("mug", "windbreaker", 2);
    expect(result).toBeGreaterThan(2);
  });

  it("does not treat short unrelated words as near matches", () => {
    // "mug" turning into "rug" would be a wrong product, not a helpful correction, which is
    // why the caller uses a budget of 1 for short words.
    expect(editDistance("mug", "rug", 1)).toBe(1);
    expect(editDistance("mug", "book", 1)).toBeGreaterThan(1);
  });

  it("handles empty input on either side", () => {
    expect(editDistance("", "", 2)).toBe(0);
    expect(editDistance("ab", "", 2)).toBe(2);
  });
});

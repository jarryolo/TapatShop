import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/v1/health", () => {
  it("returns 200 with an ok status", async () => {
    const res = GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});

import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  type Actor,
  checkSkus,
  createCategory,
  createProduct,
  deleteCategory,
  deleteVariant,
  publishBlockers,
  publishProduct,
  reorderImages,
  saveVariants,
  setProductStatus,
  slugify,
  uniqueSlug,
  updateProduct,
} from "./product.service";

/**
 * The three P1-08 acceptance criteria, against a real database:
 *   1. a product cannot be published without a variant, an image with alt text, and a price
 *   2. SKUs are unique and the collision error is human-readable
 *   3. every mutation writes an AuditLog with before and after
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let actor: Actor;
let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;

async function wipe() {
  await db.auditLog.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.inventoryMovement.deleteMany();
  await db.productImage.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.category.deleteMany();
  await db.user.deleteMany();
}

/** A product with everything a publish needs, so each test can remove one thing. */
async function completeProduct() {
  const product = await createProduct(db, actor, {
    name: unique("Brotherhood polo"),
    description: "Pique cotton polo with an embroidered chapter crest.",
  });

  await saveVariants(db, actor, product.id, [
    { sku: unique("SKU").toUpperCase(), name: "Medium / Navy", priceCents: 125000 },
  ]);

  await db.productImage.create({
    data: { productId: product.id, url: "/seed/polo.jpg", alt: "Navy polo on white", sortOrder: 0 },
  });

  return product;
}

describeIntegration("product.service", () => {
  beforeEach(async () => {
    await wipe();
    const admin = await db.user.create({
      data: { name: "Ramon", email: `admin-${unique("a")}@example.test`, role: "admin" },
    });
    actor = { id: admin.id, ip: "203.0.113.5", userAgent: "vitest" };
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("slugs", () => {
    it("strips accents so Café and Cafe do not diverge", () => {
      expect(slugify("Café Barako")).toBe("cafe-barako");
    });

    it("handles punctuation and spacing", () => {
      expect(slugify("  Chapter Windbreaker — Black!  ")).toBe("chapter-windbreaker-black");
    });

    it("appends a suffix rather than colliding", async () => {
      await createProduct(db, actor, { name: "Chapter jacket" });
      expect(await uniqueSlug(db, "Chapter jacket")).toBe("chapter-jacket-2");
    });

    it("does not change a product's slug when it is renamed", async () => {
      // A live product's URL is in search results and possibly on a printed flyer.
      const product = await createProduct(db, actor, { name: "Enamel mug" });
      const renamed = await updateProduct(db, actor, product.id, { name: "Steel enamel mug" });

      expect(renamed.name).toBe("Steel enamel mug");
      expect(renamed.slug).toBe(product.slug);
    });
  });

  describe("publish rules", () => {
    it("publishes a complete product", async () => {
      const product = await completeProduct();
      const result = await publishProduct(db, actor, product.id);

      expect(result.kind).toBe("ok");
      const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(after.status).toBe("active");
      expect(after.publishedAt).toBeInstanceOf(Date);
    });

    it("refuses a product with no variants", async () => {
      const product = await createProduct(db, actor, { name: unique("Bare"), description: "x" });
      const result = await publishProduct(db, actor, product.id);

      expect(result.kind).toBe("blocked");
      if (result.kind === "blocked") {
        expect(result.problems.map((p) => p.field)).toContain("variants");
      }
      expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe(
        "draft"
      );
    });

    it("refuses a product whose variants are all free", async () => {
      const product = await createProduct(db, actor, { name: unique("Free"), description: "x" });
      await saveVariants(db, actor, product.id, [
        { sku: unique("ZERO").toUpperCase(), name: "Default", priceCents: 0 },
      ]);
      await db.productImage.create({
        data: { productId: product.id, url: "/x.jpg", alt: "A thing", sortOrder: 0 },
      });

      const result = await publishProduct(db, actor, product.id);
      expect(result.kind).toBe("blocked");
    });

    it("refuses a product with no image", async () => {
      const product = await createProduct(db, actor, {
        name: unique("Imageless"),
        description: "x",
      });
      await saveVariants(db, actor, product.id, [
        { sku: unique("NOIMG").toUpperCase(), name: "Default", priceCents: 50000 },
      ]);

      const result = await publishProduct(db, actor, product.id);
      expect(result.kind).toBe("blocked");
      if (result.kind === "blocked")
        expect(result.problems.map((p) => p.field)).toContain("images");
    });

    it("refuses when the primary image has no alt text", async () => {
      // docs/05: block publishing a product whose primary image has none. Cheap to enforce
      // now, impossible to retrofit across a catalog later.
      const product = await completeProduct();
      const image = await db.productImage.findFirstOrThrow({ where: { productId: product.id } });
      await db.productImage.update({ where: { id: image.id }, data: { alt: "   " } });

      const result = await publishProduct(db, actor, product.id);
      expect(result.kind).toBe("blocked");
      if (result.kind === "blocked")
        expect(result.problems.map((p) => p.field)).toContain("images");
    });

    it("reports every blocker at once, not one at a time", async () => {
      const product = await createProduct(db, actor, { name: unique("Empty") });
      const problems = await publishBlockers(db, product.id);

      expect(problems.length).toBeGreaterThanOrEqual(3);
      expect(problems.map((p) => p.field)).toEqual(
        expect.arrayContaining(["variants", "images", "description"])
      );
    });

    it("ignores inactive variants when deciding", async () => {
      const product = await completeProduct();
      const variant = await db.productVariant.findFirstOrThrow({
        where: { productId: product.id },
      });
      await db.productVariant.update({ where: { id: variant.id }, data: { isActive: false } });

      const result = await publishProduct(db, actor, product.id);
      expect(result.kind).toBe("blocked");
    });

    it("keeps the original publishedAt when republished", async () => {
      const product = await completeProduct();
      await publishProduct(db, actor, product.id);
      const first = await db.product.findUniqueOrThrow({ where: { id: product.id } });

      await setProductStatus(db, actor, product.id, "draft");
      await publishProduct(db, actor, product.id);
      const second = await db.product.findUniqueOrThrow({ where: { id: product.id } });

      expect(second.publishedAt?.getTime()).toBe(first.publishedAt?.getTime());
    });
  });

  describe("SKU uniqueness", () => {
    it("rejects a SKU already used by another product, naming it", async () => {
      const sku = unique("DUP").toUpperCase();
      const first = await createProduct(db, actor, { name: unique("First") });
      await saveVariants(db, actor, first.id, [{ sku, name: "Default", priceCents: 1000 }]);

      const second = await createProduct(db, actor, { name: unique("Second") });
      const result = await saveVariants(db, actor, second.id, [
        { sku, name: "Default", priceCents: 2000 },
      ]);

      expect(result.kind).toBe("duplicate-sku");
      if (result.kind === "duplicate-sku") {
        expect(result.duplicates).toEqual([sku]);
        // Human-readable: names the SKU and says what the rule is.
        expect(result.message).toContain(sku);
        expect(result.message).toContain("unique");
        expect(result.message).not.toContain("Unique constraint");
        expect(result.message).not.toContain("P2002");
      }
    });

    it("catches duplicates inside one submitted matrix", async () => {
      // Easy to do by accident when duplicating a row in a grid editor.
      const sku = unique("SAME").toUpperCase();
      const product = await createProduct(db, actor, { name: unique("Matrix") });

      const result = await saveVariants(db, actor, product.id, [
        { sku, name: "Small", priceCents: 1000 },
        { sku, name: "Medium", priceCents: 1000 },
      ]);

      expect(result.kind).toBe("duplicate-sku");
    });

    it("treats SKUs case-insensitively when comparing within a batch", async () => {
      const product = await createProduct(db, actor, { name: unique("Case") });
      const sku = unique("CaseSku");

      const result = await saveVariants(db, actor, product.id, [
        { sku: sku.toUpperCase(), name: "Small", priceCents: 1000 },
        { sku: sku.toLowerCase(), name: "Medium", priceCents: 1000 },
      ]);

      expect(result.kind).toBe("duplicate-sku");
    });

    it("lets a variant keep its own SKU on update", async () => {
      const sku = unique("KEEP").toUpperCase();
      const product = await createProduct(db, actor, { name: unique("Keep") });
      const created = await saveVariants(db, actor, product.id, [
        { sku, name: "Default", priceCents: 1000 },
      ]);
      if (created.kind !== "ok") throw new Error("setup failed");

      const result = await saveVariants(db, actor, product.id, [
        { id: created.variantIds[0], sku, name: "Default", priceCents: 1500 },
      ]);

      expect(result.kind).toBe("ok");
    });

    it("names every duplicate, not just the first", async () => {
      const a = unique("MULTIA").toUpperCase();
      const b = unique("MULTIB").toUpperCase();
      const first = await createProduct(db, actor, { name: unique("A") });
      await saveVariants(db, actor, first.id, [
        { sku: a, name: "One", priceCents: 1000 },
        { sku: b, name: "Two", priceCents: 1000 },
      ]);

      const check = await checkSkus(db, [a, b]);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.duplicates).toHaveLength(2);
    });
  });

  describe("audit logging", () => {
    it("records a create with the new values", async () => {
      const product = await createProduct(db, actor, { name: "Tapat cap" });
      const entry = await db.auditLog.findFirstOrThrow({ where: { entityId: product.id } });

      expect(entry.action).toBe("product.create");
      expect(entry.actorId).toBe(actor.id);
      expect(entry.ip).toBe("203.0.113.5");
      expect(entry.after).toMatchObject({ name: "Tapat cap" });
    });

    it("records before and after for a price change, and only what changed", async () => {
      // "Who changed this product's price, when, and what was it before" — docs/01.
      const product = await createProduct(db, actor, { name: unique("Priced") });
      const saved = await saveVariants(db, actor, product.id, [
        { sku: unique("PRICE").toUpperCase(), name: "Default", priceCents: 125000 },
      ]);
      if (saved.kind !== "ok") throw new Error("setup failed");

      await db.auditLog.deleteMany();

      await saveVariants(db, actor, product.id, [
        {
          id: saved.variantIds[0],
          sku: (await db.productVariant.findUniqueOrThrow({ where: { id: saved.variantIds[0] } }))
            .sku,
          name: "Default",
          priceCents: 139000,
        },
      ]);

      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "variant.update" } });
      expect(entry.before).toMatchObject({ priceCents: 125000 });
      expect(entry.after).toMatchObject({ priceCents: 139000 });
      // The delta only — not the whole row, which would make the reader diff two blobs.
      expect(Object.keys(entry.after as object)).toEqual(["priceCents"]);
    });

    it("records a publish", async () => {
      const product = await completeProduct();
      await db.auditLog.deleteMany();

      await publishProduct(db, actor, product.id);
      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "product.publish" } });

      expect(entry.before).toMatchObject({ status: "draft" });
      expect(entry.after).toMatchObject({ status: "active" });
    });

    it("writes nothing when a publish is refused", async () => {
      const product = await createProduct(db, actor, { name: unique("Blocked") });
      await db.auditLog.deleteMany();

      await publishProduct(db, actor, product.id);
      expect(await db.auditLog.count()).toBe(0);
    });

    it("records an image reorder, since it decides the product card image", async () => {
      const product = await completeProduct();
      const second = await db.productImage.create({
        data: { productId: product.id, url: "/b.jpg", alt: "Detail", sortOrder: 1 },
      });
      const first = await db.productImage.findFirstOrThrow({
        where: { productId: product.id, sortOrder: 0 },
      });
      await db.auditLog.deleteMany();

      await reorderImages(db, actor, product.id, [second.id, first.id]);

      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "image.reorder" } });
      expect(entry.after).toMatchObject({ order: [second.id, first.id] });
      expect(
        (await db.productImage.findUniqueOrThrow({ where: { id: second.id } })).sortOrder
      ).toBe(0);
    });

    it("keeps images the client did not mention, rather than dropping them", async () => {
      // A stale browser tab must not delete an image someone else just added.
      const product = await completeProduct();
      const extra = await db.productImage.create({
        data: { productId: product.id, url: "/c.jpg", alt: "Extra", sortOrder: 1 },
      });
      const original = await db.productImage.findFirstOrThrow({
        where: { productId: product.id, sortOrder: 0 },
      });

      await reorderImages(db, actor, product.id, [original.id]);

      expect(await db.productImage.count({ where: { productId: product.id } })).toBe(2);
      expect((await db.productImage.findUniqueOrThrow({ where: { id: extra.id } })).sortOrder).toBe(
        1
      );
    });
  });

  describe("deletion guards", () => {
    it("refuses to delete a variant that has been sold", async () => {
      const product = await completeProduct();
      const variant = await db.productVariant.findFirstOrThrow({
        where: { productId: product.id },
      });

      const order = await db.order.create({
        data: {
          orderNo: unique("TS-ORDER"),
          subtotalCents: 125000,
          totalCents: 125000,
          shippingAddress: {},
          customerName: "Joel",
          customerEmail: "joel@example.test",
          customerPhone: "09171234567",
          items: {
            create: {
              variantId: variant.id,
              productName: product.name,
              variantName: variant.name,
              sku: variant.sku,
              unitPriceCents: 125000,
              quantity: 1,
              lineTotalCents: 125000,
            },
          },
        },
      });
      expect(order.id).toBeTruthy();

      const result = await deleteVariant(db, actor, variant.id);
      expect(result.kind).toBe("has-orders");
      expect(await db.productVariant.count({ where: { id: variant.id } })).toBe(1);
    });

    it("deletes an unsold variant", async () => {
      const product = await completeProduct();
      const variant = await db.productVariant.findFirstOrThrow({
        where: { productId: product.id },
      });

      expect((await deleteVariant(db, actor, variant.id)).kind).toBe("ok");
      expect(await db.productVariant.count({ where: { id: variant.id } })).toBe(0);
    });

    it("refuses to delete a category that still has products", async () => {
      const category = await createCategory(db, actor, { name: unique("Apparel") });
      await db.product.create({
        data: { name: unique("In category"), slug: unique("in-category"), categoryId: category.id },
      });

      const result = await deleteCategory(db, actor, category.id);
      expect(result.kind).toBe("has-products");
      if (result.kind === "has-products") expect(result.count).toBe(1);
    });
  });
});

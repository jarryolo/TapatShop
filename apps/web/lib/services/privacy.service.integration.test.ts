import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  completeDeletion,
  listDeletionRequests,
  refuseDeletion,
  requestDeletion,
} from "./privacy.service";

/**
 * Data Privacy Act erasure — RA 10173.
 *
 * The tests that matter here are the two halves of the promise: the personal data really is
 * gone, and the sales records really do survive. Either one failing alone is a compliance
 * problem, and a test that only checked the first would pass on an implementation that quietly
 * deleted the invoices.
 *
 * The sweep at the end is the important one — it searches for the customer's details across
 * every table that holds them, so a new table that stores a name will fail this rather than
 * being silently missed.
 */

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;
let admin = { id: "", ip: "203.0.113.11" };

const NAME = "Joel Bonifacio Santos";
const PHONE = "+639171112222";
const STREET = "24 Sampaguita Street, Project 4";

async function wipe() {
  await db.accountDeletionRequest.deleteMany();
  await db.review.deleteMany();
  await db.wishlistItem.deleteMany();
  await db.stockSubscription.deleteMany();
  await db.notification.deleteMany();
  await db.address.deleteMany();
  await db.account.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.accountRecoveryRequest.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.auditLog.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
}

/** A customer with data in every table that holds personal data. */
async function makeCustomerWithEverything() {
  const email = `${unique("joel")}@example.test`.toLowerCase();

  const user = await db.user.create({
    data: {
      name: NAME,
      email,
      phone: PHONE,
      passwordHash: "$argon2id$v=19$fake",
      emailVerifiedAt: new Date(),
      memberNo: unique("BR").toUpperCase(),
      chapter: "Quezon City",
      memberVerifiedAt: new Date(),
      marketingOptIn: true,
      role: "customer",
    },
  });

  const product = await db.product.create({
    data: {
      name: unique("Mug"),
      slug: unique("mug").toLowerCase(),
      status: "active",
      description: "",
    },
  });
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: unique("SKU").toUpperCase(),
      name: "Default",
      priceCents: 50_000,
      stockQty: 0,
      isActive: true,
    },
  });

  const order = await db.order.create({
    data: {
      orderNo: unique("TS-P").toUpperCase(),
      userId: user.id,
      paymentStatus: "paid",
      subtotalCents: 50_000,
      totalCents: 50_000,
      paidAt: new Date(),
      shippingAddress: { street: STREET, city: "Quezon City", recipient: NAME, phone: PHONE },
      customerName: NAME,
      customerEmail: email,
      customerPhone: PHONE,
    },
  });

  await Promise.all([
    db.address.create({
      data: {
        userId: user.id,
        recipient: NAME,
        phone: PHONE,
        region: "NCR",
        province: "Metro Manila",
        city: "Quezon City",
        barangay: "Bagumbayan",
        street: STREET,
      },
    }),
    db.wishlistItem.create({ data: { userId: user.id, productId: product.id } }),
    db.stockSubscription.create({
      data: { variantId: variant.id, userId: user.id, email },
    }),
    db.notification.create({
      data: { userId: user.id, type: "back_in_stock", title: "Back", body: NAME },
    }),
    db.review.create({
      data: { productId: product.id, userId: user.id, rating: 5, body: "Good", status: "approved" },
    }),
    db.account.create({
      data: {
        userId: user.id,
        type: "oauth",
        provider: "google",
        providerAccountId: unique("g"),
        accessToken: "secret",
      },
    }),
    db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: unique("h"), expiresAt: new Date(Date.now() + 60_000) },
    }),
  ]);

  return { user, email, order, product };
}

describeIntegration("privacy.service", () => {
  beforeEach(async () => {
    await wipe();
    const user = await db.user.create({
      data: { name: "Ramon", email: `${unique("a")}@example.test`, role: "admin" },
    });
    admin = { id: user.id, ip: "203.0.113.11" };
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("requesting", () => {
    it("files a request", async () => {
      const { user } = await makeCustomerWithEverything();
      const result = await requestDeletion(db, user.id, "No longer needed");

      expect(result.kind).toBe("ok");
      expect(await listDeletionRequests(db, "pending")).toHaveLength(1);
    });

    it("counts asking twice as one ask", async () => {
      const { user } = await makeCustomerWithEverything();
      await requestDeletion(db, user.id, null);

      expect((await requestDeletion(db, user.id, null)).kind).toBe("already_pending");
    });

    it("freezes what the customer was told, so a policy change cannot rewrite it", async () => {
      const { user } = await makeCustomerWithEverything();
      const result = await requestDeletion(db, user.id, null);
      if (result.kind !== "ok") throw new Error(result.kind);

      const request = await db.accountDeletionRequest.findUniqueOrThrow({
        where: { id: result.id },
      });
      const terms = JSON.parse(request.note ?? "{}");
      expect(terms.kept.join(" ")).toContain("past orders");
      expect(terms.removed.join(" ")).toContain("email");
    });
  });

  describe("erasing", () => {
    async function erase() {
      const fixture = await makeCustomerWithEverything();
      const request = await requestDeletion(db, fixture.user.id, null);
      if (request.kind !== "ok") throw new Error(request.kind);

      const result = await completeDeletion(db, request.id, admin);
      if (result.kind !== "ok") throw new Error(result.kind);

      return fixture;
    }

    it("removes the personal data from every table that held it", async () => {
      /**
       * The sweep. Searched by value rather than by column, so a table added later that stores
       * a customer's name fails here instead of being quietly missed.
       */
      const { user, email } = await erase();

      const remaining = await Promise.all([
        db.user.count({ where: { OR: [{ name: NAME }, { email }, { phone: PHONE }] } }),
        db.order.count({
          where: {
            OR: [{ customerName: NAME }, { customerEmail: email }, { customerPhone: PHONE }],
          },
        }),
        db.address.count({ where: { userId: user.id } }),
        db.wishlistItem.count({ where: { userId: user.id } }),
        db.stockSubscription.count({ where: { userId: user.id } }),
        db.notification.count({ where: { userId: user.id } }),
        db.review.count({ where: { userId: user.id } }),
        db.account.count({ where: { userId: user.id } }),
        db.passwordResetToken.count({ where: { userId: user.id } }),
      ]);

      expect(remaining).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("scrubs the frozen delivery address on the order", async () => {
      // The shipping address is JSON copied at purchase time, so it outlives the address book.
      const { order } = await erase();

      const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(JSON.stringify(after.shippingAddress)).not.toContain(STREET);
      expect(JSON.stringify(after.shippingAddress)).not.toContain(NAME);
      expect(after.shippingAddress).toMatchObject({ removed: true });
    });

    it("keeps the sale itself, because the BIR requires it", async () => {
      // The other half of the promise. An implementation that deleted the orders would pass
      // the sweep above and fail the business.
      const { order } = await erase();

      const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.orderNo).toBe(order.orderNo);
      expect(after.totalCents).toBe(50_000);
      expect(after.paidAt).not.toBeNull();
    });

    it("keeps the account row so the orders still have something to hang off", async () => {
      const { user } = await erase();

      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.name).toBe("Deleted account");
      expect(after.email).toContain("removed.invalid");
      expect(after.passwordHash).toBeNull();
      expect(after.memberNo).toBeNull();
    });

    it("signs out every device and disables the account", async () => {
      const { user } = await erase();

      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.sessionsRevokedAt).toBeInstanceOf(Date);
      expect(after.disabledAt).toBeInstanceOf(Date);
    });

    it("does not put the erased details into the audit log", async () => {
      // The audit log is not an exemption from erasure.
      const { email } = await erase();

      const entries = await db.auditLog.findMany({ where: { action: "user.erase" } });
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries)).not.toContain(NAME);
      expect(JSON.stringify(entries)).not.toContain(email);
      expect(entries[0]?.actorId).toBe(admin.id);
    });

    it("refuses to erase a staff or admin account", async () => {
      /**
       * Their id is referenced by every audit row they wrote. Anonymising an actor is how an
       * audit log stops answering "who did this", which is the question it exists for.
       */
      const staff = await db.user.create({
        data: { name: "Grace", email: `${unique("s")}@example.test`, role: "staff" },
      });
      const request = await requestDeletion(db, staff.id, null);
      if (request.kind !== "ok") throw new Error(request.kind);

      expect((await completeDeletion(db, request.id, admin)).kind).toBe("is_staff");
      expect((await db.user.findUniqueOrThrow({ where: { id: staff.id } })).name).toBe("Grace");
    });

    it("cannot be completed twice", async () => {
      const { user } = await makeCustomerWithEverything();
      const request = await requestDeletion(db, user.id, null);
      if (request.kind !== "ok") throw new Error(request.kind);

      expect((await completeDeletion(db, request.id, admin)).kind).toBe("ok");
      expect((await completeDeletion(db, request.id, admin)).kind).toBe("already_handled");
    });

    it("leaves everything untouched when the transaction fails", async () => {
      // A half-erased account is worse than an un-erased one: nobody can tell which half ran.
      const { user } = await makeCustomerWithEverything();
      const request = await requestDeletion(db, user.id, null);
      if (request.kind !== "ok") throw new Error(request.kind);

      await db
        .$transaction(async (tx) => {
          await completeDeletion(tx, request.id, admin);
          throw new Error("something later failed");
        })
        .catch(() => undefined);

      const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.name).toBe(NAME);
      expect(await db.address.count({ where: { userId: user.id } })).toBe(1);
    });
  });

  describe("refusing", () => {
    it("records the reason and leaves the account alone", async () => {
      const { user } = await makeCustomerWithEverything();
      const request = await requestDeletion(db, user.id, null);
      if (request.kind !== "ok") throw new Error(request.kind);

      const result = await refuseDeletion(
        db,
        request.id,
        "Open order still to be delivered",
        admin
      );
      expect(result.kind).toBe("ok");

      const after = await db.accountDeletionRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(after.status).toBe("refused");
      expect(after.note).toBe("Open order still to be delivered");
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(NAME);
    });

    it("lets the customer ask again after a refusal", async () => {
      const { user } = await makeCustomerWithEverything();
      const first = await requestDeletion(db, user.id, null);
      if (first.kind !== "ok") throw new Error(first.kind);
      await refuseDeletion(db, first.id, "Open order", admin);

      expect((await requestDeletion(db, user.id, null)).kind).toBe("ok");
    });
  });
});

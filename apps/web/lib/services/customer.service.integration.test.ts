import { PrismaClient } from "@tapatshop/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@/lib/auth/password";

import {
  approveRecovery,
  confirmRecovery,
  fileRecoveryRequest,
  getCustomer,
  listCustomers,
  recoveryEvidence,
  rejectRecovery,
  revokeMember,
  verifyMember,
} from "./customer.service";

const url = process.env.TEST_DATABASE_URL;
const describeIntegration = url ? describe : describe.skip;

const db = new PrismaClient({ datasources: { db: { url: url ?? "mysql://unused" } } });

let counter = 0;
const unique = (label: string) => `${label}-${(counter += 1)}-${process.pid}`;
let adminId = "";

async function wipe() {
  await db.accountRecoveryRequest.deleteMany();
  await db.auditLog.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.address.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();
}

async function makeCustomer(overrides: Record<string, unknown> = {}) {
  return db.user.create({
    data: {
      name: "Joel Santos",
      email: `${unique("cust")}@example.test`,
      phone: `+6391${String(Date.now()).slice(-8)}`,
      passwordHash: await hashPassword("correct horse battery staple"),
      emailVerifiedAt: new Date(),
      role: "customer",
      ...overrides,
    },
  });
}

describeIntegration("customer.service", () => {
  beforeEach(async () => {
    await wipe();
    const admin = await db.user.create({
      data: { name: "Ramon", email: `${unique("admin")}@example.test`, role: "admin" },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await wipe();
    await db.$disconnect();
  });

  describe("lifetime value", () => {
    it("counts paid orders and subtracts refunds", async () => {
      const customer = await makeCustomer();

      for (const [total, refunded, paymentStatus] of [
        [100_000, 0, "paid"],
        [50_000, 20_000, "partially_refunded"],
        [30_000, 0, "awaiting_payment"], // never paid, so not revenue
      ] as const) {
        await db.order.create({
          data: {
            orderNo: unique("TS-LTV").toUpperCase(),
            userId: customer.id,
            paymentStatus,
            totalCents: total,
            refundedCents: refunded,
            subtotalCents: total,
            shippingAddress: {},
            customerName: customer.name,
            customerEmail: customer.email,
            customerPhone: "09171234567",
          },
        });
      }

      const row = (await listCustomers(db)).find((c) => c.id === customer.id);
      // 100,000 + (50,000 − 20,000). The unpaid order contributes nothing.
      expect(row?.lifetimeValueCents).toBe(130_000);
      expect(row?.orderCount).toBe(2);
    });

    it("never returns a negative lifetime value", async () => {
      const customer = await makeCustomer();
      await db.order.create({
        data: {
          orderNo: unique("TS-NEG").toUpperCase(),
          userId: customer.id,
          paymentStatus: "refunded",
          totalCents: 10_000,
          refundedCents: 15_000,
          subtotalCents: 10_000,
          shippingAddress: {},
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: "09171234567",
        },
      });

      expect((await listCustomers(db)).find((c) => c.id === customer.id)?.lifetimeValueCents).toBe(
        0
      );
    });
  });

  describe("the customer detail view", () => {
    it("never selects the password hash", async () => {
      // An admin has no reason to see it, and a field that is never selected cannot leak.
      const customer = await makeCustomer();
      const detail = await getCustomer(db, customer.id);

      expect(detail).not.toBeNull();
      expect(JSON.stringify(detail)).not.toContain("argon2");
      expect(detail as unknown as Record<string, unknown>).not.toHaveProperty("passwordHash");
    });
  });

  describe("member verification", () => {
    it("marks a customer verified and audits it", async () => {
      const customer = await makeCustomer();

      const result = await verifyMember(db, customer.id, {
        memberNo: unique("BR").toUpperCase(),
        chapter: "Quezon City",
        actorId: adminId,
        ip: "203.0.113.5",
      });

      expect(result.kind).toBe("ok");
      const after = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.memberVerifiedAt).toBeInstanceOf(Date);
      expect(after.chapter).toBe("Quezon City");

      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "user.verify_member" } });
      expect(entry.actorId).toBe(adminId);
      expect(entry.ip).toBe("203.0.113.5");
    });

    it("refuses a member number already on another account", async () => {
      const memberNo = unique("BR").toUpperCase();
      const first = await makeCustomer();
      await verifyMember(db, first.id, { memberNo, chapter: "QC", actorId: adminId });

      const second = await makeCustomer();
      const result = await verifyMember(db, second.id, {
        memberNo,
        chapter: "QC",
        actorId: adminId,
      });

      expect(result.kind).toBe("member_no_taken");
    });

    it("lets the same account keep its own number", async () => {
      const memberNo = unique("BR").toUpperCase();
      const customer = await makeCustomer();
      await verifyMember(db, customer.id, { memberNo, chapter: "QC", actorId: adminId });

      const again = await verifyMember(db, customer.id, {
        memberNo,
        chapter: "Makati",
        actorId: adminId,
      });
      expect(again.kind).toBe("ok");
    });

    it("withdraws verification but keeps the number on record", async () => {
      const memberNo = unique("BR").toUpperCase();
      const customer = await makeCustomer();
      await verifyMember(db, customer.id, { memberNo, chapter: "QC", actorId: adminId });

      await revokeMember(db, customer.id, { actorId: adminId });

      const after = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.memberVerifiedAt).toBeNull();
      expect(after.memberNo).toBe(memberNo);
    });
  });

  describe("admin-assisted recovery", () => {
    async function customerWithOrder() {
      const customer = await makeCustomer({ memberNo: unique("BR").toUpperCase() });
      const order = await db.order.create({
        data: {
          orderNo: unique("TS-REC").toUpperCase(),
          userId: customer.id,
          paymentStatus: "paid",
          totalCents: 100_000,
          subtotalCents: 100_000,
          shippingAddress: { street: "24 Sampaguita Street", city: "Quezon City" },
          customerName: customer.name,
          customerEmail: customer.email,
          customerPhone: "09171234567",
        },
      });
      return { customer, order };
    }

    it("files a request and matches it to an account by member number", async () => {
      const { customer } = await customerWithOrder();
      const memberNo = (await db.user.findUniqueOrThrow({ where: { id: customer.id } })).memberNo;

      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedMemberNo: memberNo,
        newEmail: "joel.new@example.test",
      });

      const request = await db.accountRecoveryRequest.findUniqueOrThrow({ where: { id } });
      expect(request.userId).toBe(customer.id);
      expect(request.status).toBe("pending");
    });

    it("still files a request that matches nothing", async () => {
      // The form must not become an oracle, so an unmatched claim is stored, not refused.
      const id = await fileRecoveryRequest(db, {
        claimedName: "Nobody At All",
        claimedMemberNo: "BR-DOES-NOT-EXIST",
        newEmail: "nobody@example.test",
      });

      const request = await db.accountRecoveryRequest.findUniqueOrThrow({ where: { id } });
      expect(request.userId).toBeNull();
    });

    it("lays out the evidence and counts the matching data points", async () => {
      const { customer, order } = await customerWithOrder();
      const memberNo = (await db.user.findUniqueOrThrow({ where: { id: customer.id } })).memberNo;

      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedMemberNo: memberNo,
        claimedOrderNo: order.orderNo,
        claimedAddress: "24 Sampaguita Street",
        newEmail: "joel.new@example.test",
      });

      const evidence = await recoveryEvidence(db, id);

      expect(evidence?.checks.nameMatches).toBe(true);
      expect(evidence?.checks.memberNoMatches).toBe(true);
      expect(evidence?.checks.orderBelongsToUser).toBe(true);
      expect(evidence?.checks.addressMatches).toBe(true);
      // docs/07 wants two minimum; the admin sees the count and decides.
      expect(evidence?.matchCount).toBeGreaterThanOrEqual(2);
    });

    it("approving only sends a link — it does not move the email yet", async () => {
      const { customer } = await customerWithOrder();
      const before = await db.user.findUniqueOrThrow({ where: { id: customer.id } });

      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: before.email,
        newEmail: "joel.new@example.test",
      });

      const result = await approveRecovery(db, id, {
        actorId: adminId,
        note: "Two points matched",
      });
      expect(result.kind).toBe("ok");

      const after = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.email).toBe(before.email);
      expect(after.passwordHash).toBe(before.passwordHash);
    });

    it("NEVER changes the password, at any step", async () => {
      // The constraint docs/07 is built around: an admin can never read, set or bypass one.
      const { customer } = await customerWithOrder();
      const before = await db.user.findUniqueOrThrow({ where: { id: customer.id } });

      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: before.email,
        newEmail: "joel.new@example.test",
      });
      const approved = await approveRecovery(db, id, { actorId: adminId });
      if (approved.kind !== "ok") throw new Error("expected ok");

      await confirmRecovery(db, approved.token);

      const after = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.passwordHash).toBe(before.passwordHash);
    });

    it("confirming moves the login email and revokes every session", async () => {
      const { customer } = await customerWithOrder();
      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: customer.email,
        newEmail: "joel.new@example.test",
      });
      const approved = await approveRecovery(db, id, { actorId: adminId });
      if (approved.kind !== "ok") throw new Error("expected ok");

      const result = await confirmRecovery(db, approved.token);
      expect(result.kind).toBe("ok");

      const after = await db.user.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.email).toBe("joel.new@example.test");
      expect(after.sessionsRevokedAt).toBeInstanceOf(Date);
      expect(after.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it("burns the token, so a forwarded link cannot be replayed", async () => {
      const { customer } = await customerWithOrder();
      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: customer.email,
        newEmail: "joel.new@example.test",
      });
      const approved = await approveRecovery(db, id, { actorId: adminId });
      if (approved.kind !== "ok") throw new Error("expected ok");

      expect((await confirmRecovery(db, approved.token)).kind).toBe("ok");
      expect((await confirmRecovery(db, approved.token)).kind).toBe("invalid");
    });

    it("rejects an expired link", async () => {
      const { customer } = await customerWithOrder();
      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: customer.email,
        newEmail: "joel.new@example.test",
      });
      const approved = await approveRecovery(db, id, { actorId: adminId });
      if (approved.kind !== "ok") throw new Error("expected ok");

      await db.accountRecoveryRequest.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect((await confirmRecovery(db, approved.token)).kind).toBe("invalid");
    });

    it("stores only a hash of the token", async () => {
      const { customer } = await customerWithOrder();
      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: customer.email,
        newEmail: "joel.new@example.test",
      });
      const approved = await approveRecovery(db, id, { actorId: adminId });
      if (approved.kind !== "ok") throw new Error("expected ok");

      const request = await db.accountRecoveryRequest.findUniqueOrThrow({ where: { id } });
      expect(request.tokenHash).not.toBe(approved.token);
    });

    it("refuses to approve a request matched to nobody", async () => {
      const id = await fileRecoveryRequest(db, {
        claimedName: "Nobody",
        newEmail: "nobody@example.test",
      });

      expect((await approveRecovery(db, id, { actorId: adminId })).kind).toBe("no_user_matched");
    });

    it("cannot be approved twice", async () => {
      const { customer } = await customerWithOrder();
      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: customer.email,
        newEmail: "joel.new@example.test",
      });

      expect((await approveRecovery(db, id, { actorId: adminId })).kind).toBe("ok");
      expect((await approveRecovery(db, id, { actorId: adminId })).kind).toBe("already_handled");
    });

    it("records every decision in the audit log", async () => {
      // docs/07: every step writes an AuditLog row.
      const { customer } = await customerWithOrder();
      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: customer.email,
        newEmail: "joel.new@example.test",
      });
      await db.auditLog.deleteMany();

      await approveRecovery(db, id, { actorId: adminId, note: "Order and address matched" });

      const entry = await db.auditLog.findFirstOrThrow({
        where: { entity: "AccountRecoveryRequest" },
      });
      expect(entry.action).toBe("recovery.approve");
      expect(entry.actorId).toBe(adminId);
      expect(entry.after).toMatchObject({ status: "approved" });
    });

    it("credits the confirmation to the customer, not to the admin who approved it", async () => {
      // Two different people acted. Logging both against the admin would read as though one
      // person did the whole thing.
      const { customer } = await customerWithOrder();
      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: customer.email,
        newEmail: "joel.new@example.test",
      });
      const approved = await approveRecovery(db, id, { actorId: adminId });
      if (approved.kind !== "ok") throw new Error("expected ok");
      await confirmRecovery(db, approved.token);

      const entry = await db.auditLog.findFirstOrThrow({ where: { action: "recovery.confirm" } });
      expect(entry.actorId).toBe(customer.id);
    });

    it("rejects with a reason, and a rejected request cannot be confirmed", async () => {
      const { customer } = await customerWithOrder();
      const id = await fileRecoveryRequest(db, {
        claimedName: "Joel Santos",
        claimedEmail: customer.email,
        newEmail: "impostor@example.test",
      });

      expect(
        await rejectRecovery(db, id, { actorId: adminId, note: "Address did not match any order" })
      ).toBe(true);

      const request = await db.accountRecoveryRequest.findUniqueOrThrow({ where: { id } });
      expect(request.status).toBe("rejected");
      expect(request.tokenHash).toBeNull();
      expect(await db.auditLog.findFirst({ where: { action: "recovery.reject" } })).not.toBeNull();
    });
  });
});

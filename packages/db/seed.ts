/**
 * Seed data for local development and review. See docs/03-data-model.md.
 *
 * This is not decorative. The admin dashboard, the order timeline, and the inventory
 * ledger cannot be built or reviewed against an empty database, and a seed that violates
 * the invariants teaches everyone the wrong shape. So:
 *
 *   - every variant's stock arrives through an InventoryMovement, never a bare stockQty
 *   - every order's totals satisfy I1-I3 exactly
 *   - paid orders have a Payment row (I7) and a sale movement; the refunded one has both
 *     a Refund and a refund_return movement
 *   - the member order carries the member price as its unitPriceCents (I9), not a discount
 *
 * Re-runnable: wipes every table first, in foreign-key order.
 */

import bcrypt from "bcryptjs";

import { PrismaClient } from "./generated/client/index.js";

const db = new PrismaClient();

/** Dev-only. Real password rules live in docs/07; P1-05 owns the hashing decision. */
const DEV_PASSWORD = "tapatshop123";
const MEMBER_DISCOUNT_PERCENT = 10;

/**
 * Mirrors the rule in docs/01-product-spec.md. Rounded once, per unit, so I2 holds.
 *
 * Duplicated on purpose: the canonical implementation is apps/web/lib/utils/money.ts, and
 * packages/db must not depend on the web app. If the rounding rule ever changes, both have
 * to change. Worth collapsing into packages/shared before the mobile app needs it too.
 */
function memberUnitPrice(priceCents: number, percent: number): number {
  return priceCents - Math.round((priceCents * percent) / 100);
}

async function wipe() {
  // Order matters: children before parents.
  await db.couponRedemption.deleteMany();
  await db.review.deleteMany();
  await db.wishlistItem.deleteMany();
  await db.notification.deleteMany();
  await db.auditLog.deleteMany();
  await db.orderEvent.deleteMany();
  await db.refund.deleteMany();
  await db.payment.deleteMany();
  await db.inventoryMovement.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.stockReservation.deleteMany();
  await db.cartItem.deleteMany();
  await db.cart.deleteMany();
  await db.productImage.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.category.deleteMany();
  await db.shippingRate.deleteMany();
  await db.shippingZone.deleteMany();
  await db.coupon.deleteMany();
  await db.banner.deleteMany();
  await db.webhookEvent.deleteMany();
  await db.otpCode.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.address.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();
  await db.setting.deleteMany();
}

/**
 * The only way stock ever changes. Writes the ledger row and updates the derived cache in
 * one transaction, exactly as application code must (docs/CLAUDE.md, invariant I4).
 */
async function applyMovement(args: {
  variantId: string;
  delta: number;
  reason: "sale" | "restock" | "adjustment" | "cancellation" | "refund_return" | "damage";
  orderId?: string;
  actorId?: string;
  note?: string;
  at?: Date;
}) {
  return db.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: args.variantId },
      select: { stockQty: true },
    });
    const balanceAfter = variant.stockQty + args.delta;

    await tx.inventoryMovement.create({
      data: {
        variantId: args.variantId,
        delta: args.delta,
        reason: args.reason,
        orderId: args.orderId ?? null,
        actorId: args.actorId ?? null,
        note: args.note ?? null,
        balanceAfter,
        ...(args.at ? { createdAt: args.at } : {}),
      },
    });

    await tx.productVariant.update({
      where: { id: args.variantId },
      data: { stockQty: balanceAfter },
    });

    return balanceAfter;
  });
}

function daysAgo(n: number): Date {
  const d = new Date("2026-08-06T04:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function main() {
  console.warn("Wiping existing data...");
  await wipe();

  const passwordHash = bcrypt.hashSync(DEV_PASSWORD, 12);

  // ── settings ──────────────────────────────────────────────────────────────
  await db.setting.createMany({
    data: [
      { key: "member_discount_percent", value: MEMBER_DISCOUNT_PERCENT },
      { key: "store_name", value: "TapatShop" },
      { key: "store_tin", value: "000-000-000-000" },
      { key: "vat_percent", value: 12 },
      { key: "vat_inclusive", value: true },
      { key: "low_stock_default_threshold", value: 5 },
      { key: "absorb_payment_fees", value: true },
    ],
  });

  // ── users ─────────────────────────────────────────────────────────────────
  const admin = await db.user.create({
    data: {
      name: "Ramon Villanueva",
      email: "admin@tapatshop.com",
      emailVerifiedAt: daysAgo(200),
      phone: "+639171234567",
      phoneVerifiedAt: daysAgo(200),
      passwordHash,
      role: "admin",
      privacyAgreedAt: daysAgo(200),
      lastLoginAt: daysAgo(1),
    },
  });

  // Staff account for reviewing the reduced admin nav in P1-07.
  await db.user.create({
    data: {
      name: "Grace Mendoza",
      email: "staff@tapatshop.com",
      emailVerifiedAt: daysAgo(150),
      phone: "+639171234568",
      phoneVerifiedAt: daysAgo(150),
      passwordHash,
      role: "staff",
      privacyAgreedAt: daysAgo(150),
      lastLoginAt: daysAgo(2),
    },
  });

  // Verified member: both memberVerifiedAt and emailVerifiedAt, which is what member
  // pricing requires (docs/01 + docs/07).
  const member = await db.user.create({
    data: {
      name: "Joel Santos",
      email: "member@example.com",
      emailVerifiedAt: daysAgo(90),
      phone: "+639181234567",
      phoneVerifiedAt: daysAgo(90),
      passwordHash,
      role: "customer",
      memberNo: "BR-2024-0417",
      chapter: "Quezon City",
      memberVerifiedAt: daysAgo(88),
      privacyAgreedAt: daysAgo(90),
      marketingOptIn: true,
      lastLoginAt: daysAgo(3),
    },
  });

  // Plain customer, email not verified — useful for testing the guards.
  const customer = await db.user.create({
    data: {
      name: "Maricel Dizon",
      email: "customer@example.com",
      phone: "+639191234567",
      passwordHash,
      role: "customer",
      privacyAgreedAt: daysAgo(30),
      lastLoginAt: daysAgo(5),
    },
  });

  await db.address.create({
    data: {
      userId: member.id,
      label: "Home",
      recipient: "Joel Santos",
      phone: "+639181234567",
      region: "NCR",
      province: "Metro Manila",
      city: "Quezon City",
      barangay: "Bagumbayan",
      street: "24 Sampaguita Street, Project 4",
      postalCode: "1109",
      isDefault: true,
    },
  });

  await db.address.create({
    data: {
      userId: customer.id,
      label: "Home",
      recipient: "Maricel Dizon",
      phone: "+639191234567",
      region: "Region VII",
      province: "Cebu",
      city: "Cebu City",
      barangay: "Lahug",
      street: "88 Salinas Drive",
      postalCode: "6000",
      isDefault: true,
    },
  });

  // ── categories ────────────────────────────────────────────────────────────
  const [apparel, books, pantry, merch] = await Promise.all([
    db.category.create({
      data: {
        name: "Apparel",
        slug: "apparel",
        sortOrder: 1,
        description: "Shirts, jackets, and caps.",
      },
    }),
    db.category.create({
      data: {
        name: "Books",
        slug: "books",
        sortOrder: 2,
        description: "Devotionals and business reading.",
      },
    }),
    db.category.create({
      data: {
        name: "Food and pantry",
        slug: "food-and-pantry",
        sortOrder: 3,
        description: "Member-made goods.",
      },
    }),
    db.category.create({
      data: {
        name: "Merch",
        slug: "merch",
        sortOrder: 4,
        description: "Everyday things with the mark on them.",
      },
    }),
  ]);

  // ── products ──────────────────────────────────────────────────────────────
  type VariantSeed = {
    name: string;
    sku: string;
    priceCents: number;
    compareAtPriceCents?: number;
    stock: number;
    weightGrams: number;
  };
  type ProductSeed = {
    name: string;
    slug: string;
    brand: string;
    categoryId: string;
    description: string;
    isFeatured?: boolean;
    memberOnly?: boolean;
    variants: VariantSeed[];
  };

  const productSeeds: ProductSeed[] = [
    {
      name: "Brotherhood polo shirt",
      slug: "brotherhood-polo-shirt",
      brand: "TapatShop",
      categoryId: apparel.id,
      description:
        "Pique cotton polo with an embroidered chapter crest. Cut for Philippine weather.",
      isFeatured: true,
      variants: [
        {
          name: "Small / Navy",
          sku: "APP-POLO-S-NVY",
          priceCents: 125000,
          stock: 24,
          weightGrams: 260,
        },
        {
          name: "Medium / Navy",
          sku: "APP-POLO-M-NVY",
          priceCents: 125000,
          stock: 31,
          weightGrams: 275,
        },
        {
          name: "Large / Navy",
          sku: "APP-POLO-L-NVY",
          priceCents: 125000,
          stock: 18,
          weightGrams: 290,
        },
        {
          name: "Extra large / Navy",
          sku: "APP-POLO-XL-NVY",
          priceCents: 132500,
          stock: 4,
          weightGrams: 310,
        },
      ],
    },
    {
      name: "Chapter windbreaker",
      slug: "chapter-windbreaker",
      brand: "TapatShop",
      categoryId: apparel.id,
      description: "Light water-resistant shell for early morning meetings and the rainy season.",
      isFeatured: true,
      variants: [
        {
          name: "Medium / Black",
          sku: "APP-WIND-M-BLK",
          priceCents: 245000,
          compareAtPriceCents: 289000,
          stock: 12,
          weightGrams: 480,
        },
        {
          name: "Large / Black",
          sku: "APP-WIND-L-BLK",
          priceCents: 245000,
          compareAtPriceCents: 289000,
          stock: 9,
          weightGrams: 500,
        },
        {
          name: "Extra large / Black",
          sku: "APP-WIND-XL-BLK",
          priceCents: 259000,
          compareAtPriceCents: 299000,
          stock: 2,
          weightGrams: 520,
        },
      ],
    },
    {
      name: "Tapat cap",
      slug: "tapat-cap",
      brand: "TapatShop",
      categoryId: apparel.id,
      description: "Six-panel cotton twill cap, adjustable strap.",
      variants: [
        { name: "Default", sku: "APP-CAP-STD", priceCents: 65000, stock: 47, weightGrams: 120 },
      ],
    },
    {
      name: "Devotional journal",
      slug: "devotional-journal",
      brand: "Tapat Press",
      categoryId: books.id,
      description: "A year of dated pages with room for notes. Sewn binding, lies flat.",
      isFeatured: true,
      variants: [
        { name: "Default", sku: "BOK-JRNL-2026", priceCents: 49500, stock: 60, weightGrams: 420 },
      ],
    },
    {
      name: "Faith at work",
      slug: "faith-at-work",
      brand: "Tapat Press",
      categoryId: books.id,
      description:
        "Twelve essays from members on running a business without leaving your conscience at the door.",
      variants: [
        { name: "Paperback", sku: "BOK-FAW-PB", priceCents: 62000, stock: 35, weightGrams: 340 },
        { name: "Hardcover", sku: "BOK-FAW-HC", priceCents: 98000, stock: 14, weightGrams: 620 },
      ],
    },
    {
      name: "Proverbs for business",
      slug: "proverbs-for-business",
      brand: "Tapat Press",
      categoryId: books.id,
      description: "A short daily reader pairing a proverb with a practical question.",
      variants: [
        { name: "Default", sku: "BOK-PFB-PB", priceCents: 55000, stock: 41, weightGrams: 300 },
      ],
    },
    {
      name: "Barako coffee beans",
      slug: "barako-coffee-beans",
      brand: "Cavite Highlands",
      categoryId: pantry.id,
      description:
        "Single-origin Liberica from a member's farm in Amadeo. Roasted to order, medium dark.",
      isFeatured: true,
      variants: [
        {
          name: "250g / Whole bean",
          sku: "FOD-COF-250-WB",
          priceCents: 38000,
          stock: 52,
          weightGrams: 250,
        },
        {
          name: "500g / Whole bean",
          sku: "FOD-COF-500-WB",
          priceCents: 69000,
          stock: 38,
          weightGrams: 500,
        },
        {
          name: "1kg / Whole bean",
          sku: "FOD-COF-1K-WB",
          priceCents: 129000,
          stock: 3,
          weightGrams: 1000,
        },
      ],
    },
    {
      name: "Calamansi honey",
      slug: "calamansi-honey",
      brand: "Bataan Apiary",
      categoryId: pantry.id,
      description: "Raw wildflower honey infused with calamansi zest. Unpasteurised.",
      variants: [
        { name: "250ml", sku: "FOD-HON-250", priceCents: 29500, stock: 44, weightGrams: 420 },
        { name: "500ml", sku: "FOD-HON-500", priceCents: 52000, stock: 21, weightGrams: 780 },
      ],
    },
    {
      name: "Adobo spice mix",
      slug: "adobo-spice-mix",
      brand: "Lola Fe's",
      categoryId: pantry.id,
      description: "Dry rub blend, no MSG. Enough for eight kilos of pork or chicken.",
      variants: [
        { name: "Default", sku: "FOD-ADO-STD", priceCents: 18500, stock: 73, weightGrams: 180 },
      ],
    },
    {
      name: "Enamel mug",
      slug: "enamel-mug",
      brand: "TapatShop",
      categoryId: merch.id,
      description: "350ml steel enamel mug. Survives being dropped, which is the point.",
      variants: [
        { name: "Default", sku: "MER-MUG-350", priceCents: 42000, stock: 29, weightGrams: 320 },
      ],
    },
    {
      name: "Canvas tote bag",
      slug: "canvas-tote-bag",
      brand: "TapatShop",
      categoryId: merch.id,
      description: "12oz unbleached canvas with reinforced handles.",
      variants: [
        { name: "Default", sku: "MER-TOT-STD", priceCents: 35000, stock: 56, weightGrams: 240 },
      ],
    },
    {
      name: "Chapter lapel pin",
      slug: "chapter-lapel-pin",
      brand: "TapatShop",
      categoryId: merch.id,
      description: "Hard enamel pin with a butterfly clutch. Issued to members, sold to anyone.",
      memberOnly: true,
      variants: [
        { name: "Default", sku: "MER-PIN-STD", priceCents: 22500, stock: 88, weightGrams: 20 },
      ],
    },
  ];

  const variantBySku = new Map<
    string,
    { id: string; productName: string; variantName: string; priceCents: number }
  >();

  for (const seed of productSeeds) {
    const product = await db.product.create({
      data: {
        name: seed.name,
        slug: seed.slug,
        brand: seed.brand,
        categoryId: seed.categoryId,
        description: seed.description,
        status: "active",
        isFeatured: seed.isFeatured ?? false,
        memberOnly: seed.memberOnly ?? false,
        publishedAt: daysAgo(60),
        images: {
          create: [
            {
              url: `/seed/${seed.slug}-1.jpg`,
              alt: `${seed.name} on a white background`,
              sortOrder: 0,
            },
            {
              url: `/seed/${seed.slug}-2.jpg`,
              alt: `${seed.name}, detail view`,
              sortOrder: 1,
            },
          ],
        },
      },
    });

    for (const v of seed.variants) {
      const variant = await db.productVariant.create({
        data: {
          productId: product.id,
          sku: v.sku,
          name: v.name,
          priceCents: v.priceCents,
          compareAtPriceCents: v.compareAtPriceCents ?? null,
          weightGrams: v.weightGrams,
          stockQty: 0, // arrives via the ledger below, never set directly
        },
      });

      variantBySku.set(v.sku, {
        id: variant.id,
        productName: seed.name,
        variantName: v.name,
        priceCents: v.priceCents,
      });

      await applyMovement({
        variantId: variant.id,
        delta: v.stock,
        reason: "restock",
        actorId: admin.id,
        note: "Opening stock",
        at: daysAgo(60),
      });
    }
  }

  // ── shipping ──────────────────────────────────────────────────────────────
  type RateSeed = {
    name: string;
    baseCents: number;
    perKgCents: number;
    freeAboveCents: number | null;
    etaDaysMin: number;
    etaDaysMax: number;
  };
  const zones: { name: string; regions: string[]; rates: RateSeed[] }[] = [
    {
      name: "Metro Manila",
      regions: ["NCR"],
      rates: [
        {
          name: "Standard",
          baseCents: 8000,
          perKgCents: 0,
          freeAboveCents: 250000,
          etaDaysMin: 1,
          etaDaysMax: 3,
        },
        {
          name: "Express",
          baseCents: 18000,
          perKgCents: 0,
          freeAboveCents: null,
          etaDaysMin: 1,
          etaDaysMax: 1,
        },
      ],
    },
    {
      name: "Luzon",
      regions: [
        "Region I",
        "Region II",
        "Region III",
        "Region IV-A",
        "Region IV-B",
        "Region V",
        "CAR",
      ],
      rates: [
        {
          name: "Standard",
          baseCents: 13000,
          perKgCents: 3000,
          freeAboveCents: 350000,
          etaDaysMin: 2,
          etaDaysMax: 5,
        },
      ],
    },
    {
      name: "Visayas",
      regions: ["Region VI", "Region VII", "Region VIII"],
      rates: [
        {
          name: "Standard",
          baseCents: 17500,
          perKgCents: 4500,
          freeAboveCents: 500000,
          etaDaysMin: 3,
          etaDaysMax: 7,
        },
      ],
    },
    {
      name: "Mindanao",
      regions: ["Region IX", "Region X", "Region XI", "Region XII", "Region XIII", "BARMM"],
      rates: [
        {
          name: "Standard",
          baseCents: 19500,
          perKgCents: 5000,
          freeAboveCents: 500000,
          etaDaysMin: 4,
          etaDaysMax: 9,
        },
      ],
    },
  ];

  for (const [i, zone] of zones.entries()) {
    await db.shippingZone.create({
      data: {
        name: zone.name,
        regions: zone.regions,
        sortOrder: i,
        rates: { create: zone.rates },
      },
    });
  }

  // ── coupons ───────────────────────────────────────────────────────────────
  const welcome = await db.coupon.create({
    data: {
      code: "WELCOME10",
      type: "percentage",
      percentage: 10,
      minSubtotalCents: 100000,
      maxUses: 500,
      maxUsesPerUser: 1,
      startsAt: daysAgo(60),
      endsAt: daysAgo(-90),
    },
  });

  await db.coupon.create({
    data: {
      code: "KAPATIRANSHIP",
      type: "free_shipping",
      minSubtotalCents: 150000,
      membersOnly: true,
      maxUsesPerUser: 3,
      startsAt: daysAgo(30),
    },
  });

  // ── banners ───────────────────────────────────────────────────────────────
  await db.banner.createMany({
    data: [
      {
        title: "Straight dealing, every order",
        subtitle: "Clear prices. No countdown timers.",
        imageUrl: "/seed/banner-hero.jpg",
        linkUrl: "/products",
        placement: "home_hero",
        sortOrder: 0,
      },
      {
        title: "New: Barako from Amadeo",
        subtitle: "Roasted to order by a member farm.",
        imageUrl: "/seed/banner-coffee.jpg",
        linkUrl: "/products/barako-coffee-beans",
        placement: "home_secondary",
        sortOrder: 1,
      },
    ],
  });

  // ── orders ────────────────────────────────────────────────────────────────
  type OrderSeed = {
    orderNo: string;
    user?: { id: string; name: string; email: string; phone: string | null };
    guestEmail?: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    applyMemberPrice: boolean;
    status: "pending" | "confirmed" | "cancelled" | "completed";
    paymentStatus:
      "unpaid" | "awaiting_payment" | "paid" | "partially_refunded" | "refunded" | "failed";
    fulfillmentStatus: "unfulfilled" | "packed" | "shipped" | "delivered" | "returned";
    lines: { sku: string; quantity: number }[];
    shippingCents: number;
    shippingMethod: string;
    couponCode?: string;
    discountCents?: number;
    placedDaysAgo: number;
    trackingNumber?: string;
    carrier?: string;
    cancelReason?: string;
    refund?: { amountCents: number; reason: string; restock: boolean };
    address: {
      recipient: string;
      phone: string;
      region: string;
      province: string;
      city: string;
      barangay: string;
      street: string;
      postalCode: string;
    };
  };

  const manilaAddress = {
    recipient: "Joel Santos",
    phone: "+639181234567",
    region: "NCR",
    province: "Metro Manila",
    city: "Quezon City",
    barangay: "Bagumbayan",
    street: "24 Sampaguita Street, Project 4",
    postalCode: "1109",
  };

  const cebuAddress = {
    recipient: "Maricel Dizon",
    phone: "+639191234567",
    region: "Region VII",
    province: "Cebu",
    city: "Cebu City",
    barangay: "Lahug",
    street: "88 Salinas Drive",
    postalCode: "6000",
  };

  const guestAddress = {
    recipient: "Ana Reyes",
    phone: "+639201234567",
    region: "Region III",
    province: "Pampanga",
    city: "San Fernando",
    barangay: "Del Pilar",
    street: "12 Jose Abad Santos Avenue",
    postalCode: "2000",
  };

  const orderSeeds: OrderSeed[] = [
    // 1. Guest, sitting at the PayMongo page right now.
    {
      orderNo: "TS-2026-000101",
      guestEmail: "ana.reyes@example.com",
      customerName: "Ana Reyes",
      customerEmail: "ana.reyes@example.com",
      customerPhone: "+639201234567",
      applyMemberPrice: false,
      status: "pending",
      paymentStatus: "awaiting_payment",
      fulfillmentStatus: "unfulfilled",
      lines: [{ sku: "MER-MUG-350", quantity: 2 }],
      shippingCents: 13000,
      shippingMethod: "Luzon standard",
      placedDaysAgo: 0,
      address: guestAddress,
    },
    // 2. The member order. Member price is the unit price (I9).
    {
      orderNo: "TS-2026-000102",
      user: member,
      customerName: member.name,
      customerEmail: member.email,
      customerPhone: member.phone ?? "",
      applyMemberPrice: true,
      status: "confirmed",
      paymentStatus: "paid",
      fulfillmentStatus: "unfulfilled",
      lines: [
        { sku: "APP-POLO-M-NVY", quantity: 1 },
        { sku: "FOD-COF-500-WB", quantity: 3 },
      ],
      shippingCents: 0,
      shippingMethod: "Metro Manila standard (free over ₱2,500)",
      placedDaysAgo: 2,
      address: manilaAddress,
    },
    // 3. Paid and packed, with a coupon applied.
    {
      orderNo: "TS-2026-000103",
      user: customer,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone ?? "",
      applyMemberPrice: false,
      status: "confirmed",
      paymentStatus: "paid",
      fulfillmentStatus: "packed",
      lines: [
        { sku: "BOK-FAW-HC", quantity: 1 },
        { sku: "BOK-JRNL-2026", quantity: 2 },
      ],
      shippingCents: 17500,
      shippingMethod: "Visayas standard",
      couponCode: "WELCOME10",
      placedDaysAgo: 5,
      address: cebuAddress,
    },
    // 4. Shipped, tracking in hand.
    {
      orderNo: "TS-2026-000104",
      user: member,
      customerName: member.name,
      customerEmail: member.email,
      customerPhone: member.phone ?? "",
      applyMemberPrice: true,
      status: "confirmed",
      paymentStatus: "paid",
      fulfillmentStatus: "shipped",
      lines: [{ sku: "APP-WIND-L-BLK", quantity: 1 }],
      shippingCents: 8000,
      shippingMethod: "Metro Manila standard",
      placedDaysAgo: 9,
      trackingNumber: "JNT-PH-4471902388",
      carrier: "J&T Express",
      address: manilaAddress,
    },
    // 5. Completed and delivered.
    {
      orderNo: "TS-2026-000105",
      user: customer,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone ?? "",
      applyMemberPrice: false,
      status: "completed",
      paymentStatus: "paid",
      fulfillmentStatus: "delivered",
      lines: [
        { sku: "FOD-HON-500", quantity: 2 },
        { sku: "FOD-ADO-STD", quantity: 3 },
      ],
      shippingCents: 17500,
      shippingMethod: "Visayas standard",
      placedDaysAgo: 21,
      trackingNumber: "LBC-PH-9920174455",
      carrier: "LBC",
      address: cebuAddress,
    },
    // 6. Returned and refunded, stock put back.
    {
      orderNo: "TS-2026-000106",
      user: customer,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone ?? "",
      applyMemberPrice: false,
      status: "completed",
      paymentStatus: "refunded",
      fulfillmentStatus: "returned",
      lines: [{ sku: "APP-POLO-XL-NVY", quantity: 1 }],
      shippingCents: 17500,
      shippingMethod: "Visayas standard",
      placedDaysAgo: 34,
      trackingNumber: "LBC-PH-9920166201",
      carrier: "LBC",
      refund: { amountCents: 150000, reason: "Wrong size ordered, returned unworn", restock: true },
      address: cebuAddress,
    },
  ];

  // A cancelled order that never got paid — the seventh status combination worth having.
  orderSeeds.push({
    orderNo: "TS-2026-000107",
    guestEmail: "paolo.cruz@example.com",
    customerName: "Paolo Cruz",
    customerEmail: "paolo.cruz@example.com",
    customerPhone: "+639211234567",
    applyMemberPrice: false,
    status: "cancelled",
    paymentStatus: "failed",
    fulfillmentStatus: "unfulfilled",
    lines: [{ sku: "MER-TOT-STD", quantity: 1 }],
    shippingCents: 13000,
    shippingMethod: "Luzon standard",
    placedDaysAgo: 12,
    cancelReason: "Payment failed at the provider and was not retried",
    address: guestAddress,
  });

  for (const seed of orderSeeds) {
    const placedAt = daysAgo(seed.placedDaysAgo);

    const items = seed.lines.map((line) => {
      const variant = variantBySku.get(line.sku);
      if (!variant) throw new Error(`Seed refers to an unknown sku: ${line.sku}`);

      const unitPriceCents = seed.applyMemberPrice
        ? memberUnitPrice(variant.priceCents, MEMBER_DISCOUNT_PERCENT)
        : variant.priceCents;

      return {
        variantId: variant.id,
        productName: variant.productName,
        variantName: variant.variantName,
        sku: line.sku,
        imageUrl: null,
        unitPriceCents,
        quantity: line.quantity,
        lineTotalCents: unitPriceCents * line.quantity, // I2
      };
    });

    const subtotalCents = items.reduce((sum, i) => sum + i.lineTotalCents, 0); // I3
    const discountCents =
      seed.discountCents ?? (seed.couponCode === "WELCOME10" ? Math.round(subtotalCents * 0.1) : 0);

    // vatCents is 0 here: prices are VAT-inclusive, so adding VAT again would break I1.
    // The BIR breakdown is derived at invoice render. Flagged for P3-02.
    const vatCents = 0;
    const totalCents = subtotalCents + seed.shippingCents + vatCents - discountCents; // I1

    const isPaid = ["paid", "partially_refunded", "refunded"].includes(seed.paymentStatus);

    const order = await db.order.create({
      data: {
        orderNo: seed.orderNo,
        userId: seed.user?.id ?? null,
        guestEmail: seed.guestEmail ?? null,
        status: seed.status,
        paymentStatus: seed.paymentStatus,
        fulfillmentStatus: seed.fulfillmentStatus,
        subtotalCents,
        shippingCents: seed.shippingCents,
        discountCents,
        vatCents,
        totalCents,
        refundedCents: seed.refund?.amountCents ?? 0,
        couponCode: seed.couponCode ?? null,
        shippingAddress: seed.address,
        customerName: seed.customerName,
        customerEmail: seed.customerEmail,
        customerPhone: seed.customerPhone,
        shippingMethod: seed.shippingMethod,
        trackingNumber: seed.trackingNumber ?? null,
        carrier: seed.carrier ?? null,
        cancelReason: seed.cancelReason ?? null,
        placedAt,
        paidAt: isPaid ? placedAt : null,
        shippedAt: ["shipped", "delivered", "returned"].includes(seed.fulfillmentStatus)
          ? daysAgo(seed.placedDaysAgo - 1)
          : null,
        deliveredAt: ["delivered", "returned"].includes(seed.fulfillmentStatus)
          ? daysAgo(seed.placedDaysAgo - 4)
          : null,
        cancelledAt: seed.status === "cancelled" ? daysAgo(seed.placedDaysAgo - 1) : null,
        createdAt: placedAt,
        items: { create: items },
      },
    });

    // Payment. I7: an order is only `paid` if a paid Payment row exists.
    if (isPaid) {
      // PayMongo publishes roughly 2.5% on e-wallets. Stored so margin reporting is
      // possible later without re-deriving it. See docs/06.
      const feeCents = Math.round(totalCents * 0.025);
      await db.payment.create({
        data: {
          orderId: order.id,
          checkoutSessionId: `cs_seed_${seed.orderNo}`,
          paymentIntentId: `pi_seed_${seed.orderNo}`,
          providerPaymentId: `pay_seed_${seed.orderNo}`,
          method: "gcash",
          amountCents: totalCents,
          feeCents,
          netCents: totalCents - feeCents,
          status: seed.paymentStatus === "failed" ? "failed" : "paid",
          paidAt: placedAt,
          createdAt: placedAt,
        },
      });

      // Stock leaves on the paid webhook, not at checkout. See docs/06.
      for (const item of items) {
        await applyMovement({
          variantId: item.variantId,
          delta: -item.quantity,
          reason: "sale",
          orderId: order.id,
          note: `Order ${seed.orderNo}`,
          at: placedAt,
        });
      }
    } else if (seed.paymentStatus === "failed") {
      await db.payment.create({
        data: {
          orderId: order.id,
          checkoutSessionId: `cs_seed_${seed.orderNo}`,
          method: "card",
          amountCents: totalCents,
          status: "failed",
          createdAt: placedAt,
        },
      });
    }

    // Coupon redemption, once the order is actually paid.
    if (seed.couponCode === "WELCOME10" && isPaid) {
      await db.couponRedemption.create({
        data: {
          couponId: welcome.id,
          userId: seed.user?.id ?? null,
          orderId: order.id,
          discountCents,
          createdAt: placedAt,
        },
      });
      await db.coupon.update({
        where: { id: welcome.id },
        data: { usedCount: { increment: 1 } },
      });
    }

    // Refund, and the stock coming back with a reason attached.
    if (seed.refund) {
      await db.refund.create({
        data: {
          orderId: order.id,
          providerRefundId: `ref_seed_${seed.orderNo}`,
          amountCents: seed.refund.amountCents,
          reason: seed.refund.reason,
          status: "succeeded",
          restockItems: seed.refund.restock,
          actorId: admin.id,
          createdAt: daysAgo(seed.placedDaysAgo - 20),
        },
      });

      if (seed.refund.restock) {
        for (const item of items) {
          await applyMovement({
            variantId: item.variantId,
            delta: item.quantity,
            reason: "refund_return",
            orderId: order.id,
            actorId: admin.id,
            note: seed.refund.reason,
            at: daysAgo(seed.placedDaysAgo - 20),
          });
        }
      }

      await db.auditLog.create({
        data: {
          actorId: admin.id,
          action: "order.refund",
          entity: "Order",
          entityId: order.id,
          before: { paymentStatus: "paid", refundedCents: 0 },
          after: { paymentStatus: seed.paymentStatus, refundedCents: seed.refund.amountCents },
          createdAt: daysAgo(seed.placedDaysAgo - 20),
        },
      });
    }

    // Timeline. I8: every paid transition leaves an event behind.
    const events: { type: string; message: string; isPublic: boolean; at: Date }[] = [
      { type: "order_placed", message: "Order placed.", isPublic: true, at: placedAt },
    ];
    if (isPaid) {
      events.push({
        type: "payment_received",
        message: "Payment received via GCash.",
        isPublic: true,
        at: placedAt,
      });
    }
    if (seed.paymentStatus === "failed") {
      events.push({
        type: "payment_failed",
        message: "Payment was declined by the provider.",
        isPublic: true,
        at: placedAt,
      });
    }
    if (seed.fulfillmentStatus === "packed") {
      events.push({
        type: "status_changed",
        message: "Packed and waiting for pickup.",
        isPublic: true,
        at: daysAgo(seed.placedDaysAgo - 1),
      });
    }
    if (seed.trackingNumber) {
      events.push({
        type: "shipped",
        message: `Shipped via ${seed.carrier}, tracking ${seed.trackingNumber}.`,
        isPublic: true,
        at: daysAgo(seed.placedDaysAgo - 1),
      });
    }
    if (["delivered", "returned"].includes(seed.fulfillmentStatus)) {
      events.push({
        type: "status_changed",
        message: "Delivered.",
        isPublic: true,
        at: daysAgo(seed.placedDaysAgo - 4),
      });
    }
    if (seed.refund) {
      events.push({
        type: "refunded",
        message: `Refunded: ${seed.refund.reason}`,
        isPublic: true,
        at: daysAgo(seed.placedDaysAgo - 20),
      });
      events.push({
        type: "note_added",
        message: "Item inspected on return, resalable.",
        isPublic: false,
        at: daysAgo(seed.placedDaysAgo - 20),
      });
    }
    if (seed.cancelReason) {
      events.push({
        type: "status_changed",
        message: `Cancelled. ${seed.cancelReason}`,
        isPublic: true,
        at: daysAgo(seed.placedDaysAgo - 1),
      });
    }

    await db.orderEvent.createMany({
      data: events.map((e) => ({
        orderId: order.id,
        type: e.type,
        message: e.message,
        isPublic: e.isPublic,
        createdAt: e.at,
      })),
    });
  }

  // ── reviews, wishlist, notifications ──────────────────────────────────────
  const journal = variantBySku.get("BOK-JRNL-2026");
  const coffee = variantBySku.get("FOD-COF-500-WB");

  const journalProduct = await db.product.findUniqueOrThrow({
    where: { slug: "devotional-journal" },
  });
  const coffeeProduct = await db.product.findUniqueOrThrow({
    where: { slug: "barako-coffee-beans" },
  });
  const polo = await db.product.findUniqueOrThrow({ where: { slug: "brotherhood-polo-shirt" } });

  await db.review.createMany({
    data: [
      {
        productId: journalProduct.id,
        userId: customer.id,
        rating: 5,
        title: "Lies flat, which matters",
        body: "Been using it every morning since March. The binding holds up.",
        status: "approved",
        createdAt: daysAgo(15),
      },
      {
        productId: coffeeProduct.id,
        userId: member.id,
        rating: 4,
        title: "Strong, as barako should be",
        body: "Arrived four days after roasting. Would like a finer grind option.",
        status: "approved",
        createdAt: daysAgo(7),
      },
      {
        productId: polo.id,
        userId: member.id,
        rating: 5,
        title: "Good cut",
        body: "Runs slightly large. Order one size down if you are between sizes.",
        status: "pending",
        createdAt: daysAgo(1),
      },
    ],
  });

  await db.wishlistItem.createMany({
    data: [
      { userId: member.id, productId: journalProduct.id, createdAt: daysAgo(10) },
      { userId: customer.id, productId: polo.id, createdAt: daysAgo(4) },
    ],
  });

  await db.notification.createMany({
    data: [
      {
        userId: member.id,
        type: "order_shipped",
        title: "Your order is on the way",
        body: "Order TS-2026-000104 shipped via J&T Express.",
        linkUrl: "/account/orders/TS-2026-000104",
        createdAt: daysAgo(8),
      },
      {
        userId: customer.id,
        type: "back_in_stock",
        title: "Back in stock",
        body: "Chapter windbreaker, extra large, is available again.",
        linkUrl: "/products/chapter-windbreaker",
        readAt: daysAgo(2),
        createdAt: daysAgo(3),
      },
    ],
  });

  // A live guest cart, so the cart merge path in P2-04 has something to work against.
  if (journal && coffee) {
    const guestCart = await db.cart.create({
      data: {
        guestToken: "seed-guest-cart-token",
        expiresAt: daysAgo(-30),
      },
    });
    await db.cartItem.createMany({
      data: [
        { cartId: guestCart.id, variantId: journal.id, quantity: 1 },
        { cartId: guestCart.id, variantId: coffee.id, quantity: 2 },
      ],
    });
  }

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: "user.verify_member",
      entity: "User",
      entityId: member.id,
      before: { memberNo: null, memberVerifiedAt: null },
      after: { memberNo: "BR-2024-0417", chapter: "Quezon City" },
      createdAt: daysAgo(88),
    },
  });

  await verify();
}

/**
 * Checks the invariants the schema cannot express. If the seed itself violates them, every
 * feature built against it inherits the bug.
 */
async function verify() {
  const problems: string[] = [];

  const orders = await db.order.findMany({ include: { items: true, payments: true } });
  for (const o of orders) {
    const subtotal = o.items.reduce((s, i) => s + i.lineTotalCents, 0);
    if (subtotal !== o.subtotalCents)
      problems.push(`I3 ${o.orderNo}: subtotal ${o.subtotalCents} != ${subtotal}`);

    const total = o.subtotalCents + o.shippingCents + o.vatCents - o.discountCents;
    if (total !== o.totalCents) problems.push(`I1 ${o.orderNo}: total ${o.totalCents} != ${total}`);

    for (const i of o.items) {
      if (i.lineTotalCents !== i.unitPriceCents * i.quantity) {
        problems.push(`I2 ${o.orderNo}/${i.sku}: line total does not equal unit x qty`);
      }
    }

    if (o.refundedCents > o.totalCents) problems.push(`I6 ${o.orderNo}: refunded exceeds total`);

    if (o.paymentStatus === "paid" && !o.payments.some((p) => p.status === "paid")) {
      problems.push(`I7 ${o.orderNo}: marked paid with no paid Payment row`);
    }
  }

  const variants = await db.productVariant.findMany({ include: { movements: true } });
  for (const v of variants) {
    const ledger = v.movements.reduce((s, m) => s + m.delta, 0);
    if (ledger !== v.stockQty)
      problems.push(`I4 ${v.sku}: stockQty ${v.stockQty} != ledger ${ledger}`);
    if (v.stockQty < 0) problems.push(`I5 ${v.sku}: negative stock`);
  }

  if (problems.length > 0) {
    console.error("Seed violates its own invariants:");
    for (const p of problems) console.error(`  - ${p}`);
    throw new Error(`${problems.length} invariant violation(s)`);
  }

  const counts = {
    users: await db.user.count(),
    categories: await db.category.count(),
    products: await db.product.count(),
    variants: await db.productVariant.count(),
    orders: await db.order.count(),
    movements: await db.inventoryMovement.count(),
    coupons: await db.coupon.count(),
    shippingRates: await db.shippingRate.count(),
    settings: await db.setting.count(),
  };

  console.warn("Seed complete. Invariants I1-I7 hold.");
  console.warn(counts);
  console.warn(`Sign in with any seeded email and the password: ${DEV_PASSWORD}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });

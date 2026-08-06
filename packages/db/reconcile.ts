/**
 * Stock reconciliation. Rebuilds `stockQty` from the inventory ledger and reports drift.
 *
 *   pnpm db:reconcile          report only, changes nothing
 *   pnpm db:reconcile --repair rewrite stockQty from the ledger
 *
 * docs/03 decision 3: the ledger is append-only truth and stockQty is a derived cache. This
 * is the job that proves the two still agree — and the reason the ledger exists at all.
 *
 * Reports by default. A tool that silently repaired would hide the bug that caused the drift,
 * and drift means something wrote stock outside a movement transaction, which is worth
 * finding rather than papering over.
 *
 * Exits 1 when drift is found and not repaired, so a cron can alert on it.
 */

import { PrismaClient } from "./generated/client/index.js";

const db = new PrismaClient();

interface Drift {
  sku: string;
  productName: string;
  stockQty: number;
  ledgerTotal: number;
  difference: number;
}

async function main() {
  const repair = process.argv.includes("--repair");

  const variants = await db.productVariant.findMany({
    select: { id: true, sku: true, stockQty: true, product: { select: { name: true } } },
  });

  const totals = await db.inventoryMovement.groupBy({
    by: ["variantId"],
    _sum: { delta: true },
  });
  const ledgerBy = new Map(totals.map((row) => [row.variantId, row._sum.delta ?? 0]));

  const drift: (Drift & { id: string })[] = [];

  for (const variant of variants) {
    const ledgerTotal = ledgerBy.get(variant.id) ?? 0;
    if (ledgerTotal !== variant.stockQty) {
      drift.push({
        id: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        stockQty: variant.stockQty,
        ledgerTotal,
        difference: variant.stockQty - ledgerTotal,
      });
    }
  }

  console.warn(`Checked ${variants.length} variants against the ledger.`);

  if (drift.length === 0) {
    console.warn(
      "No drift. stockQty matches sum(movements.delta) everywhere — invariant I4 holds."
    );
    await db.$disconnect();
    return;
  }

  console.error(`\nDRIFT on ${drift.length} variant${drift.length === 1 ? "" : "s"}:\n`);
  console.error(["SKU", "Product", "stockQty", "ledger", "diff"].map((h) => h.padEnd(18)).join(""));

  for (const row of drift) {
    console.error(
      [
        row.sku,
        row.productName.slice(0, 16),
        String(row.stockQty),
        String(row.ledgerTotal),
        (row.difference > 0 ? "+" : "") + String(row.difference),
      ]
        .map((cell) => cell.padEnd(18))
        .join("")
    );
  }

  if (!repair) {
    console.error(
      "\nNothing was changed. Re-run with --repair to rewrite stockQty from the ledger."
    );
    console.error(
      "Drift means something wrote stock outside a movement transaction. Find that first."
    );
    await db.$disconnect();
    process.exit(1);
  }

  for (const row of drift) {
    await db.productVariant.update({
      where: { id: row.id },
      data: { stockQty: row.ledgerTotal },
    });
  }

  console.warn(`\nRepaired ${drift.length}. stockQty now matches the ledger.`);
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});

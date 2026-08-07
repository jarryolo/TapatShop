import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/api/guard";
import { db } from "@/lib/db";
import { listSettings } from "@/lib/services/settings.service";

import { SettingField, type SettingRow } from "./settings-form";

export const metadata: Metadata = { title: "Settings — TapatShop admin" };
export const dynamic = "force-dynamic";

const GROUPS: { key: string; title: string; blurb: string }[] = [
  { key: "store", title: "Store", blurb: "Shown to customers on the shop, receipts and emails." },
  {
    key: "pricing",
    title: "Pricing",
    blurb: "Member pricing applies at the unit level, before any coupon.",
  },
  {
    key: "operations",
    title: "Operations",
    blurb: "Payment keys are write-only — they can be replaced, never read back.",
  },
];

export default async function AdminSettingsPage() {
  // Admin only. Re-checked here, not just in middleware, per docs/02.
  await requireAdminPage();

  const settings = await listSettings(db);

  const rows: SettingRow[] = settings.map((setting) => ({
    key: setting.key,
    label: setting.label,
    hint: setting.hint,
    kind: setting.kind,
    group: setting.group,
    secret: setting.secret,
    value: setting.value,
    isSet: setting.isSet,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold md:text-[32px] md:leading-tight">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Admin only. Every change is recorded in the{" "}
          <Link
            href="/admin/audit-logs?entity=Setting"
            className="font-semibold text-brand-600 hover:underline"
          >
            audit log
          </Link>
          . Each field saves on its own, so one change is one entry.
        </p>
      </header>

      {GROUPS.map((group) => {
        const groupRows = rows.filter((row) => row.group === group.key);
        if (groupRows.length === 0) return null;

        return (
          <Card key={group.key}>
            <CardHeader>
              <CardTitle>{group.title}</CardTitle>
            </CardHeader>
            <p className="mt-1 text-sm text-text-muted">{group.blurb}</p>

            <div className="mt-2 divide-y divide-border">
              {groupRows.map((row) => (
                <SettingField key={row.key} setting={row} />
              ))}
            </div>
          </Card>
        );
      })}

      <p className="text-[13px] text-text-muted">
        Shipping zones and rates live under their own screen, and staff accounts under Staff.
      </p>
    </div>
  );
}

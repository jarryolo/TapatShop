import type { Prisma, PrismaClient } from "@tapatshop/db";

import { db } from "@/lib/db";

import { log } from "./audit.service";

/**
 * Store settings. Admin-only — docs/01 and docs/04.
 *
 * Every setting is declared below rather than accepting arbitrary keys. An open key-value
 * endpoint lets a typo create `member_discount_percnt`, which saves cleanly, reads as nothing
 * everywhere, and turns member pricing off with no error anywhere to explain it.
 */
type Db = PrismaClient | Prisma.TransactionClient;

export type SettingKind = "string" | "int" | "boolean";

export interface SettingDef {
  key: string;
  label: string;
  hint?: string;
  kind: SettingKind;
  min?: number;
  max?: number;
  group: "store" | "pricing" | "operations";
  /**
   * Secrets are write-only. They can be set and cleared, never read back.
   *
   * docs/CLAUDE.md forbids admins seeing payment card data; a live PayMongo secret key is the
   * same category of thing — anyone holding it can charge cards and issue refunds. The admin
   * who pastes it does not need to read it again, and nobody else ever should.
   */
  secret?: boolean;
}

export const SETTINGS: readonly SettingDef[] = [
  { key: "store_name", label: "Store name", kind: "string", group: "store" },
  {
    key: "store_email",
    label: "Contact email",
    hint: "Shown on receipts and order emails.",
    kind: "string",
    group: "store",
  },
  { key: "store_phone", label: "Contact number", kind: "string", group: "store" },
  {
    key: "store_tin",
    label: "TIN",
    hint: "Printed on invoices.",
    kind: "string",
    group: "store",
  },
  {
    key: "member_discount_percent",
    label: "Member discount",
    hint: "A whole percentage off every product for verified members. 0 turns member pricing off entirely.",
    kind: "int",
    min: 0,
    max: 100,
    group: "pricing",
  },
  {
    key: "low_stock_default_threshold",
    label: "Default low-stock threshold",
    hint: "Used for new variants. Each variant can override it.",
    kind: "int",
    min: 0,
    max: 10_000,
    group: "operations",
  },
  {
    key: "absorb_payment_fees",
    label: "Absorb payment fees",
    hint: "Off means the fee is passed to the customer.",
    kind: "boolean",
    group: "pricing",
  },
  {
    key: "announcement",
    label: "Announcement bar",
    hint: "Shown across the top of the shop. Leave blank to hide it.",
    kind: "string",
    group: "store",
  },
  {
    key: "paymongo_secret_key",
    label: "PayMongo secret key",
    hint: "Write-only. Saving replaces it; it is never shown again.",
    kind: "string",
    group: "operations",
    secret: true,
  },
  {
    key: "paymongo_webhook_secret",
    label: "PayMongo webhook secret",
    hint: "Write-only. Used to verify webhook signatures.",
    kind: "string",
    group: "operations",
    secret: true,
  },
];

const BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));

export function settingDef(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

export interface SettingView {
  key: string;
  label: string;
  hint?: string;
  kind: SettingKind;
  group: SettingDef["group"];
  secret: boolean;
  /** Always null for a secret. `isSet` is the only thing an admin gets to know about it. */
  value: string | number | boolean | null;
  isSet: boolean;
  updatedAt: Date | null;
}

const SECRET_KEYS = SETTINGS.filter((setting) => setting.secret).map((setting) => setting.key);

/**
 * Every declared setting, with its current value — except secrets, which never come back.
 *
 * Two queries rather than one filtered afterwards, because a secret's value must never enter
 * this process on the read path at all. Masking a value already in hand is a comment away
 * from being undone, and it leaves the plaintext sitting inside a Server Component render:
 * Next's dev build ships the resolved value of every awaited promise to the browser for its
 * performance timeline, so a `findMany()` that selected the column put a live PayMongo key
 * into the page source. A column that is never selected cannot be handed to anything.
 */
export async function listSettings(tx: Db): Promise<SettingView[]> {
  const [plain, secrets] = await Promise.all([
    tx.setting.findMany({
      where: { key: { notIn: SECRET_KEYS } },
      select: { key: true, value: true, updatedAt: true },
    }),
    tx.setting.findMany({
      where: { key: { in: SECRET_KEYS } },
      // No `value`. This is the whole point of splitting the query.
      select: { key: true, updatedAt: true },
    }),
  ]);

  const plainByKey = new Map(plain.map((row) => [row.key, row]));
  const secretByKey = new Map(secrets.map((row) => [row.key, row]));

  return SETTINGS.map((setting) => {
    const common = {
      key: setting.key,
      label: setting.label,
      hint: setting.hint,
      kind: setting.kind,
      group: setting.group,
    };

    if (setting.secret) {
      const row = secretByKey.get(setting.key);
      return {
        ...common,
        secret: true,
        value: null,
        // A row only exists once it has been written, and saving "" deletes it below.
        isSet: row !== undefined,
        updatedAt: row?.updatedAt ?? null,
      };
    }

    const row = plainByKey.get(setting.key);
    const raw = row?.value ?? null;

    return {
      ...common,
      secret: false,
      value: raw as SettingView["value"],
      isSet: raw !== null && raw !== undefined && raw !== "",
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/** One setting's value, for code that needs it. Bypasses the secret masking on purpose. */
export async function readSetting<T>(tx: Db, key: string, fallback: T): Promise<T> {
  const row = await tx.setting.findUnique({ where: { key } });
  return row?.value === undefined || row?.value === null ? fallback : (row.value as T);
}

export type SaveSettingResult =
  { kind: "ok" } | { kind: "unknown_key" } | { kind: "invalid"; message: string };

/** Coerces and range-checks against the declaration. */
function coerce(
  def: SettingDef,
  value: unknown
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (def.kind === "boolean") {
    if (typeof value === "boolean") return { ok: true, value };
    return { ok: false, message: `${def.label} has to be on or off.` };
  }

  if (def.kind === "int") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(number)) {
      return { ok: false, message: `${def.label} has to be a whole number.` };
    }
    if (def.min !== undefined && number < def.min) {
      return { ok: false, message: `${def.label} cannot be below ${def.min}.` };
    }
    if (def.max !== undefined && number > def.max) {
      return { ok: false, message: `${def.label} cannot be above ${def.max}.` };
    }
    return { ok: true, value: number };
  }

  if (typeof value !== "string") {
    return { ok: false, message: `${def.label} has to be text.` };
  }
  return { ok: true, value: value.trim() };
}

/**
 * Writes one setting, audited.
 *
 * A secret's value never reaches the audit log — the row records that it changed and who
 * changed it, which is the whole point, without putting the key itself in a table that gets
 * exported into spreadsheets.
 */
export async function saveSetting(
  tx: Db,
  key: string,
  value: unknown,
  actor: { id: string; ip?: string | null; userAgent?: string | null }
): Promise<SaveSettingResult> {
  const def = settingDef(key);
  if (!def) return { kind: "unknown_key" };

  const coerced = coerce(def, value);
  if (!coerced.ok) return { kind: "invalid", message: coerced.message };

  if (def.secret) {
    // Reads existence, never the value — same reason as listSettings.
    const existed = await tx.setting.findUnique({ where: { key }, select: { key: true } });
    const cleared = coerced.value === "";

    if (cleared) {
      if (existed) await tx.setting.delete({ where: { key } });
    } else {
      await tx.setting.upsert({
        where: { key },
        create: { key, value: coerced.value as Prisma.InputJsonValue },
        update: { value: coerced.value as Prisma.InputJsonValue },
      });
    }

    await log(tx, {
      actorId: actor.id,
      action: "setting.update",
      entity: "Setting",
      entityId: key,
      // What changed, never what it changed to.
      before: { key, wasSet: existed !== null },
      after: { key, isSet: !cleared },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { kind: "ok" };
  }

  const before = await tx.setting.findUnique({ where: { key } });

  await tx.setting.upsert({
    where: { key },
    create: { key, value: coerced.value as Prisma.InputJsonValue },
    update: { value: coerced.value as Prisma.InputJsonValue },
  });

  await log(tx, {
    actorId: actor.id,
    action: "setting.update",
    entity: "Setting",
    entityId: key,
    before: { value: before?.value },
    after: { value: coerced.value },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });

  return { kind: "ok" };
}

export const settingsService = {
  list: () => listSettings(db),
  save: (key: string, value: unknown, actor: Parameters<typeof saveSetting>[3]) =>
    db.$transaction((tx) => saveSetting(tx, key, value, actor)),
  read: <T>(key: string, fallback: T) => readSetting(db, key, fallback),
};

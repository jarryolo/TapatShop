"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { type Column, DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils/format";

export interface StockRow extends Record<string, unknown> {
  id: string;
  sku: string;
  productId: string;
  productName: string;
  variantName: string;
  stockQty: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isLow: boolean;
}

interface Movement {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  balanceAfter: number;
  createdAt: string;
  actor: { id: string; name: string } | null;
  order: { orderNo: string } | null;
}

const REASONS = [
  { value: "restock", label: "Restock — new stock arrived" },
  { value: "adjustment", label: "Adjustment — recount" },
  { value: "damage", label: "Damage — written off" },
  { value: "cancellation", label: "Cancellation — returned to stock" },
];

export function InventoryView({ rows }: { rows: StockRow[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const [lowOnly, setLowOnly] = useState(false);
  const [selected, setSelected] = useState<StockRow | null>(null);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("restock");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  async function open(row: StockRow) {
    setSelected(row);
    setMovements(null);
    setDelta("");
    setNote("");
    setReason("restock");

    const response = await fetch(`/api/v1/admin/inventory/${row.id}/movements`);
    if (response.ok) setMovements((await response.json()).data);
  }

  async function submit() {
    if (!selected) return;
    setPending(true);

    const response = await fetch("/api/v1/admin/inventory/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variantId: selected.id,
        delta: Number(delta),
        reason,
        note,
      }),
    });

    setPending(false);
    const body = await response.json();

    if (!response.ok) {
      toast(body.error?.message ?? "Could not adjust the stock.", "error");
      return;
    }

    toast(`Stock is now ${body.data.balanceAfter}.`, "success");
    setSelected(null);
    router.refresh();
  }

  const columns: Column<StockRow>[] = [
    {
      key: "productName",
      header: "Product",
      sortable: true,
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold">{row.productName}</span>
          <span className="block truncate text-[13px] text-text-muted">
            {row.variantName} · {row.sku}
          </span>
        </span>
      ),
    },
    {
      key: "stockQty",
      header: "On hand",
      sortable: true,
      align: "right",
      render: (row) => (
        <span className={row.stockQty === 0 ? "text-danger-text" : undefined}>{row.stockQty}</span>
      ),
    },
    {
      key: "reserved",
      header: "Reserved",
      sortable: true,
      align: "right",
      secondary: true,
      render: (row) => (row.reserved > 0 ? row.reserved : "—"),
    },
    {
      key: "available",
      header: "Available",
      sortable: true,
      align: "right",
      // On hand minus what checkout is holding. This is the number that decides a sale.
      render: (row) => <span className="font-semibold">{row.available}</span>,
    },
    {
      key: "isLow",
      header: "State",
      render: (row) =>
        row.stockQty === 0 ? (
          <Badge tone="danger">Out of stock</Badge>
        ) : row.isLow ? (
          <Badge tone="warning">Low</Badge>
        ) : (
          <Badge tone="success">OK</Badge>
        ),
    },
  ];

  const visible = lowOnly ? rows.filter((row) => row.isLow) : rows;

  return (
    <div className="flex flex-col gap-4">
      <Checkbox
        id="lowOnly"
        label="Low stock only"
        checked={lowOnly}
        onChange={(event) => setLowOnly(event.target.checked)}
      />

      <DataTable
        caption="Stock on hand, reserved and available, per variant"
        rows={visible}
        columns={columns}
        rowKey={(row) => row.id}
        searchKeys={["sku", "productName", "variantName"]}
        searchPlaceholder="Search SKU or product"
        perPage={20}
        onRowActivate={open}
        emptyTitle="Nothing matches"
        emptyBody="Try a different SKU or product name."
      />

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.productName} — ${selected.variantName}` : ""}
        description={selected ? `${selected.sku} · ${selected.stockQty} on hand` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
            <Button loading={pending} disabled={!delta || !note.trim()} onClick={submit}>
              Save adjustment
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              id="delta"
              label="Change"
              required
              hint="Negative to write off, positive to add."
            >
              <Input
                id="delta"
                inputMode="numeric"
                placeholder="-2"
                value={delta}
                hint="Negative to write off, positive to add."
                onChange={(event) => setDelta(event.target.value.replace(/[^\d-]/g, ""))}
              />
            </Field>

            <Field id="reason" label="Reason" required>
              <Select
                id="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                {REASONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            id="note"
            label="Note"
            required
            hint="Mandatory. This is what someone reads in six months asking why the number changed."
          >
            <Textarea
              id="note"
              rows={2}
              value={note}
              hint="Mandatory. This is what someone reads in six months asking why the number changed."
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Movement history</h3>
            {movements === null ? (
              <p className="text-sm text-text-muted">Loading…</p>
            ) : movements.length === 0 ? (
              <p className="text-sm text-text-muted">No movements yet.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border-subtle text-text-muted">
                      <th scope="col" className="py-1.5">
                        When
                      </th>
                      <th scope="col" className="py-1.5 text-right">
                        Change
                      </th>
                      <th scope="col" className="py-1.5 text-right">
                        Balance
                      </th>
                      <th scope="col" className="py-1.5">
                        Reason
                      </th>
                      <th scope="col" className="py-1.5">
                        Who
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.id} className="border-b border-border-subtle last:border-0">
                        <td className="py-1.5">{formatDateTime(movement.createdAt)}</td>
                        <td
                          className={`py-1.5 text-right tabular-nums ${movement.delta < 0 ? "text-danger-text" : "text-success-text"}`}
                        >
                          {movement.delta > 0 ? "+" : ""}
                          {movement.delta}
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">
                          {movement.balanceAfter}
                        </td>
                        <td className="py-1.5">
                          {movement.reason.replace(/_/g, " ")}
                          {movement.note ? (
                            <span className="block text-text-muted">{movement.note}</span>
                          ) : null}
                          {movement.order ? (
                            <span className="block text-text-muted">{movement.order.orderNo}</span>
                          ) : null}
                        </td>
                        {/* System movements have no actor — a sale is not a person. */}
                        <td className="py-1.5">{movement.actor?.name ?? "System"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

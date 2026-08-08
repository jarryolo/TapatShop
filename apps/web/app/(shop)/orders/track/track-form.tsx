"use client";

import { useState } from "react";

import { OrderSummary, type CustomerOrder } from "@/components/shop/order-summary";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function TrackForm() {
  const [orderNo, setOrderNo] = useState("");
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setOrder(null);

    const response = await fetch(
      `/api/v1/orders/track?orderNo=${encodeURIComponent(orderNo)}&email=${encodeURIComponent(email)}`
    );
    const body = await response.json();
    setPending(false);

    if (!response.ok) {
      // Same message whether the order does not exist or the email does not match, so this
      // form cannot be used to discover which order numbers are real.
      setError(body.error?.message ?? "Something went wrong. Try again.");
      return;
    }

    setOrder(body.data);
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field id="orderNo" label="Order number" required hint="Like TS-2026-000123.">
            <Input
              id="orderNo"
              required
              value={orderNo}
              placeholder="TS-2026-000123"
              hint="Like TS-2026-000123."
              onChange={(event) => setOrderNo(event.target.value)}
            />
          </Field>

          <Field id="email" label="Email" required>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          {error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-ctrl)] border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" loading={pending}>
            Find my order
          </Button>
        </form>
      </Card>

      {order ? (
        <Card>
          <OrderSummary order={order} />
        </Card>
      ) : null}
    </div>
  );
}

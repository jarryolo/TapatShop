"use client";

import Link from "next/link";
import { useState } from "react";

import { type AddressValue, AddressFields } from "@/components/shop/address-fields";
import { useCart } from "@/components/shop/cart-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { formatPeso } from "@/lib/utils/money";

interface ShippingOption {
  rateId: string;
  name: string;
  zoneName: string;
  feeCents: number;
  originalFeeCents: number | null;
  etaDaysMin: number;
  etaDaysMax: number;
  spendMoreForFreeCents: number | null;
}

interface Change {
  kind: string;
  message: string;
}

interface Quote {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  couponCode: string | null;
  shippingOptions: ShippingOption[];
  changes: Change[];
}

const STEPS = ["Address", "Shipping", "Payment"] as const;

export function CheckoutFlow({
  signedIn,
  accountEmail,
  accountName,
}: {
  signedIn: boolean;
  accountEmail: string;
  accountName: string;
}) {
  const { cart } = useCart();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [rateId, setRateId] = useState<string | null>(null);
  const [email, setEmail] = useState(accountEmail);
  const [address, setAddress] = useState<AddressValue>({
    region: "",
    province: "",
    city: "",
    barangay: "",
    street: "",
    postalCode: "",
  });
  const [recipient, setRecipient] = useState(accountName);
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (cart.lines.length === 0) {
    return (
      <Card>
        <p className="font-semibold">Your cart is empty</p>
        <p className="mt-1 text-sm text-text-muted">
          Add something before checking out.{" "}
          <Link href="/products" className="font-semibold text-brand-600 hover:underline">
            Browse the catalog
          </Link>
        </p>
      </Card>
    );
  }

  function payload() {
    return {
      recipient,
      phone,
      region: address.region,
      province: address.province,
      city: address.city,
      barangay: address.barangay,
      street: address.street,
      postalCode: address.postalCode || null,
    };
  }

  /**
   * Re-prices before showing shipping options.
   *
   * `seenSubtotalCents` is what the browser is currently displaying — the server uses it only
   * to decide whether to warn that something moved. It is never treated as a price.
   */
  async function goToShipping() {
    setPending(true);
    setErrors({});

    const response = await fetch("/api/v1/checkout/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: payload(),
        shippingRateId: null,
        seenSubtotalCents: cart.subtotalCents,
      }),
    });

    setPending(false);
    const body = await response.json();

    if (!response.ok) {
      setErrors(body.error?.details?.fields ?? {});
      toast(body.error?.message ?? "Check the address and try again.", "error");
      return;
    }

    setQuote(body.data);
    setRateId(body.data.shippingOptions[0]?.rateId ?? null);
    setStep(1);
  }

  async function goToPayment() {
    if (!rateId) return;
    setPending(true);

    const response = await fetch("/api/v1/checkout/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: payload(), shippingRateId: rateId }),
    });

    setPending(false);
    const body = await response.json();

    if (!response.ok) {
      toast(body.error?.message ?? "Something changed. Check your cart.", "error");
      return;
    }

    setQuote(body.data);
    setStep(2);
  }

  async function pay() {
    if (!rateId) return;
    setPending(true);

    const response = await fetch("/api/v1/checkout/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: payload(),
        shippingRateId: rateId,
        email: signedIn ? undefined : email,
        name: recipient,
      }),
    });

    const body = await response.json();
    setPending(false);

    if (!response.ok) {
      // Stock taken, price moved, or the provider refused — all before any money moved.
      toast(body.error?.message ?? "Could not start payment.", "error");
      if (body.error?.details?.changes) setStep(1);
      return;
    }

    /**
     * The coupon was taken by someone else while this checkout committed.
     *
     * Shown before the redirect, not after — the customer is about to see a total higher
     * than the cart did, and hearing why on the payment page is too late to matter.
     */
    if (body.changes?.length) {
      for (const change of body.changes as { message: string }[]) toast(change.message, "info");
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    window.location.href = body.checkoutUrl;
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex items-center gap-2" aria-label="Checkout progress">
        {STEPS.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                index < step
                  ? "bg-success-soft text-success-text"
                  : index === step
                    ? "bg-brand-600 text-white"
                    : "bg-page text-text-soft"
              )}
            >
              {index < step ? "✓" : index + 1}
            </span>
            <span
              className={cn("text-[13px]", index === step ? "font-semibold" : "text-text-muted")}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      {quote?.changes && quote.changes.length > 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-ctrl)] border-l-4 border-warning bg-warning-soft px-3 py-2 text-sm"
        >
          <ul className="flex flex-col gap-1">
            {quote.changes.map((change) => (
              <li key={change.message}>{change.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 0 ? (
        <Card className="flex flex-col gap-4">
          {!signedIn ? (
            <Field id="email" label="Email" required hint="Your receipt and updates go here.">
              <Input
                id="email"
                type="email"
                required
                value={email}
                hint="Your receipt and updates go here."
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          ) : null}

          <Field id="recipient" label="Recipient" required error={errors.recipient}>
            <Input
              id="recipient"
              value={recipient}
              error={errors.recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </Field>

          <Field id="phone" label="Mobile number" required error={errors.phone}>
            <Input
              id="phone"
              type="tel"
              placeholder="09171234567"
              value={phone}
              error={errors.phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>

          <AddressFields value={address} onChange={setAddress} errors={errors} />

          <Button loading={pending} onClick={goToShipping}>
            Continue to shipping
          </Button>
        </Card>
      ) : null}

      {step === 1 && quote ? (
        <Card className="flex flex-col gap-4">
          <fieldset className="border-0 p-0">
            <legend className="mb-2 font-semibold">Shipping method</legend>
            <div className="flex flex-col gap-2">
              {quote.shippingOptions.map((option) => (
                <label
                  key={option.rateId}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-[var(--radius-ctrl)] border p-3",
                    option.rateId === rateId
                      ? "border-brand-600 bg-brand-50"
                      : "border-border-strong"
                  )}
                >
                  <input
                    type="radio"
                    name="rate"
                    checked={option.rateId === rateId}
                    onChange={() => setRateId(option.rateId)}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className="block font-semibold">{option.name}</span>
                    <span className="block text-[13px] text-text-muted">
                      {option.zoneName} · {option.etaDaysMin}–{option.etaDaysMax} days
                    </span>
                    {option.spendMoreForFreeCents ? (
                      <span className="block text-[13px] text-text-muted">
                        Spend {formatPeso(option.spendMoreForFreeCents)} more for free shipping
                      </span>
                    ) : null}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {option.feeCents === 0 ? "Free" : formatPeso(option.feeCents)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button className="flex-1" loading={pending} onClick={goToPayment} disabled={!rateId}>
              Continue to payment
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 2 && quote ? (
        <Card className="flex flex-col gap-4">
          <dl className="flex flex-col gap-2 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-text-muted">Subtotal</dt>
              <dd className="tabular-nums">{formatPeso(quote.subtotalCents)}</dd>
            </div>
            {quote.discountCents > 0 ? (
              <div className="flex justify-between text-success-text">
                <dt>Discount {quote.couponCode ? `(${quote.couponCode})` : ""}</dt>
                <dd className="tabular-nums">−{formatPeso(quote.discountCents)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-text-muted">Shipping</dt>
              <dd className="tabular-nums">
                {quote.shippingCents === 0 ? "Free" : formatPeso(quote.shippingCents)}
              </dd>
            </div>
          </dl>

          <div className="flex justify-between border-t border-border-subtle pt-3 text-lg font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatPeso(quote.totalCents)}</span>
          </div>

          <p className="text-[13px] text-text-muted">
            You will be taken to PayMongo to pay with GCash, Maya, a card or online banking. Your
            card details never touch our servers.
          </p>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button className="flex-1" size="lg" loading={pending} onClick={pay}>
              Pay {formatPeso(quote.totalCents)}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

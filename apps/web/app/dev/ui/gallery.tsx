"use client";

import { useState } from "react";

import { type AddressValue, AddressFields } from "@/components/shop/address-fields";
import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Radio, Switch } from "@/components/ui/choice";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal, Sheet } from "@/components/ui/modal";
import { Pagination } from "@/components/ui/pagination";
import { Price } from "@/components/ui/price";
import { Rating, RatingInput } from "@/components/ui/rating";
import { ProductCardSkeleton, Skeleton, TableRowSkeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-8">
      <h2 className="text-xl font-semibold md:text-2xl">{title}</h2>
      {note ? <p className="mt-1 text-sm text-text-muted">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle py-3 last:border-0">
      <span className="w-28 shrink-0 text-[13px] font-medium text-text-muted">{label}</span>
      {children}
    </div>
  );
}

export function Gallery() {
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [address, setAddress] = useState<AddressValue>({
    region: "",
    province: "",
    city: "",
    barangay: "",
    street: "",
    postalCode: "",
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 md:px-6 md:py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold md:text-[44px] md:leading-[1.1]">UI gallery</h1>
        <p className="mt-2 max-w-2xl text-text-muted">
          Every primitive from docs/05-design-system.md, in every state. Tab through this page with
          the keyboard — every interactive element must show a visible focus ring.
        </p>
      </header>

      <div className="flex flex-col gap-12">
        <Section
          title="Colour"
          note="The only colours in the product. Nothing else may be hardcoded."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["brand-50", "bg-brand-50 text-text"],
              ["brand-100", "bg-brand-100 text-text"],
              ["brand-200", "bg-brand-200 text-text"],
              ["brand-400", "bg-brand-400 text-white"],
              ["brand-600", "bg-brand-600 text-white"],
              ["brand-800", "bg-brand-800 text-white"],
              ["brand-900", "bg-brand-900 text-white"],
            ].map(([name, classes]) => (
              <div
                key={name}
                className={`rounded-[var(--radius-ctrl)] p-3 text-xs font-semibold ${classes}`}
              >
                {name}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-text-muted">
            brand-400 fails 4.5:1 on white and must never be used for text — docs/05.
          </p>
        </Section>

        <Section title="Type">
          <div className="flex flex-col gap-2">
            <p className="text-3xl font-semibold md:text-[44px] md:leading-[1.1]">
              Display — honest goods
            </p>
            <p className="text-2xl font-semibold md:text-[32px]">H1 — Brotherhood polo shirt</p>
            <p className="text-xl font-semibold md:text-2xl">H2 — Category</p>
            <p className="text-[17px] font-semibold md:text-lg">H3 — Card title</p>
            <p className="text-[15px] md:text-base">
              Body — clear pricing, no dark patterns, no fake urgency.
            </p>
            <p className="text-[13px] md:text-sm">Small — shipping estimate and helper text.</p>
            <p className="text-xs">Caption — SKU APP-POLO-M-NVY</p>
          </div>
        </Section>

        <Section title="Button" note="Never more than one primary per view.">
          <Card>
            <Row label="Primary">
              <Button size="sm">Small</Button>
              <Button>Add to cart</Button>
              <Button size="lg">Large</Button>
            </Row>
            <Row label="Secondary">
              <Button variant="secondary" size="sm">
                Small
              </Button>
              <Button variant="secondary">Continue shopping</Button>
              <Button variant="secondary" size="lg">
                Large
              </Button>
            </Row>
            <Row label="Ghost">
              <Button variant="ghost">Cancel</Button>
            </Row>
            <Row label="Danger">
              <Button variant="danger">Refund order</Button>
            </Row>
            <Row label="Disabled">
              <Button disabled>Primary</Button>
              <Button variant="secondary" disabled>
                Secondary
              </Button>
              <Button variant="danger" disabled>
                Danger
              </Button>
            </Row>
            <Row label="Loading">
              <Button loading>Placing order</Button>
              <Button variant="secondary" loading>
                Saving
              </Button>
            </Row>
            <Row label="Full width">
              <div className="w-full max-w-xs">
                <Button fullWidth>Add to cart</Button>
              </div>
            </Row>
          </Card>
        </Section>

        <Section
          title="Form controls"
          note="44px minimum touch target. Errors linked with aria-describedby."
        >
          <Card className="grid gap-5 md:grid-cols-2">
            <Field id="email" label="Email" required hint="We send order updates here.">
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                hint="We send order updates here."
              />
            </Field>

            <Field
              id="email-error"
              label="Email"
              required
              error="That email is already registered."
            >
              <Input
                id="email-error"
                type="email"
                defaultValue="joel@example"
                error="That email is already registered."
              />
            </Field>

            <Field id="price" label="Price" hint="Entered in pesos, stored in centavos.">
              <Input
                id="price"
                inputMode="decimal"
                prefix="₱"
                placeholder="0.00"
                hint="Entered in pesos, stored in centavos."
              />
            </Field>

            <Field id="disabled" label="SKU" hint="Generated from the variant.">
              <Input id="disabled" defaultValue="APP-POLO-M-NVY" disabled />
            </Field>

            <Field id="region" label="Region" required>
              <Select id="region" defaultValue="NCR">
                <option value="NCR">NCR</option>
                <option value="Region III">Region III</option>
                <option value="Region VII">Region VII</option>
              </Select>
            </Field>

            <Field id="note" label="Order note" hint="Optional. Visible to the packing team.">
              <Textarea
                id="note"
                placeholder="Leave with the guard, please."
                hint="Optional. Visible to the packing team."
              />
            </Field>

            <div className="flex flex-col gap-1">
              <Checkbox
                id="privacy"
                label="I agree to the privacy policy"
                hint="Required by the Data Privacy Act."
              />
              <Checkbox id="marketing" label="Send me occasional updates" defaultChecked />
              <Checkbox id="cb-disabled" label="Disabled option" disabled />
            </div>

            <div className="flex flex-col gap-1">
              <Radio id="ship-standard" name="ship" label="Standard — 2 to 5 days" defaultChecked />
              <Radio id="ship-express" name="ship" label="Express — next day" hint="₱180.00" />
              <Radio id="ship-disabled" name="ship" label="Not available for Cebu" disabled />
            </div>

            <Switch
              id="published"
              label="Published"
              hint="Visible in the storefront."
              defaultChecked
            />
            <Switch id="sw-disabled" label="Member only" disabled />
          </Card>
        </Section>

        <Section
          title="Price"
          note="The struck-through price is dropped unless it is a genuine saving."
        >
          <Card className="flex flex-col gap-4">
            <Price cents={125000} />
            <Price cents={245000} compareAtCents={289000} />
            <Price cents={112500} isMemberPrice size="lg" />
            <Price cents={125000} compareAtCents={100000} />
            <span className="text-[13px] text-text-muted">
              The last row passes a lower compare-at price. Nothing is struck through, by design.
            </span>
          </Card>
        </Section>

        <Section title="Badge and rating">
          <Card>
            <Row label="Badges">
              <Badge tone="success">Paid</Badge>
              <Badge tone="warning">3 left</Badge>
              <Badge tone="danger">Cancelled</Badge>
              <Badge tone="neutral">Draft</Badge>
              <Badge tone="brand">Member</Badge>
            </Row>
            <Row label="Rating">
              <Rating value={4.5} count={28} />
            </Row>
            <Row label="Rating input">
              <RatingInput name="demo-rating" defaultValue={4} />
            </Row>
          </Card>
        </Section>

        <Section title="Card">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Order TS-2026-000102</CardTitle>
                  <CardDescription>Placed 2 days ago by Joel Santos</CardDescription>
                </div>
                <Badge tone="success">Paid</Badge>
              </CardHeader>
              <Price cents={298800} />
              <CardFooter>
                <Button size="sm">View order</Button>
                <Button size="sm" variant="ghost">
                  Print packing slip
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Low stock</CardTitle>
              </CardHeader>
              <ul className="flex flex-col gap-2 text-[15px]">
                <li className="flex items-center justify-between">
                  <span>Chapter windbreaker, XL</span>
                  <Badge tone="warning">2 left</Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span>Barako coffee, 1kg</span>
                  <Badge tone="warning">3 left</Badge>
                </li>
              </ul>
            </Card>
          </div>
        </Section>

        <Section
          title="Overlays"
          note="Native dialog: focus trap, Escape to close, and backdrop click."
        >
          <Card>
            <Row label="Triggers">
              <Button variant="secondary" onClick={() => setModalOpen(true)}>
                Open modal
              </Button>
              <Button variant="secondary" onClick={() => setSheetOpen(true)}>
                Open side sheet
              </Button>
              <Button variant="secondary" onClick={() => setBottomSheetOpen(true)}>
                Open bottom sheet
              </Button>
            </Row>
            <Row label="Toasts">
              <Button variant="secondary" onClick={() => toast("Added to cart.", "success")}>
                Success
              </Button>
              <Button
                variant="secondary"
                onClick={() => toast("That coupon has expired. Try another code.", "error")}
              >
                Error
              </Button>
              <Button variant="secondary" onClick={() => toast("Stock updated.", "info")}>
                Info
              </Button>
            </Row>
          </Card>

          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Refund this order?"
            description="Refunds are irreversible."
            footer={
              <>
                <Button variant="ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => setModalOpen(false)}>
                  Refund ₱2,988.00
                </Button>
              </>
            }
          >
            <p className="text-[15px] text-text-muted">
              The full amount returns to the customer&rsquo;s GCash account. Stock will be returned
              to inventory with a movement row recording why.
            </p>
          </Modal>

          <Sheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title="Your cart"
            footer={
              <Button fullWidth onClick={() => setSheetOpen(false)}>
                Checkout
              </Button>
            }
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">Brotherhood polo shirt</p>
                  <p className="text-[13px] text-text-muted">Medium / Navy</p>
                </div>
                <Price cents={125000} size="sm" />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">Barako coffee beans</p>
                  <p className="text-[13px] text-text-muted">500g / Whole bean × 3</p>
                </div>
                <Price cents={207000} size="sm" />
              </div>
            </div>
          </Sheet>

          <Sheet
            open={bottomSheetOpen}
            onClose={() => setBottomSheetOpen(false)}
            title="Filters"
            side="bottom"
          >
            <div className="flex flex-col gap-1">
              <Checkbox id="filter-stock" label="In stock only" />
              <Checkbox id="filter-featured" label="Featured" />
            </div>
          </Sheet>
        </Section>

        <Section title="Tabs" note="Arrow keys move between tabs. Home and End jump to the ends.">
          <Card>
            <Tabs
              items={[
                {
                  id: "description",
                  label: "Description",
                  content: (
                    <p className="text-[15px] text-text-muted">
                      Pique cotton polo with an embroidered chapter crest.
                    </p>
                  ),
                },
                {
                  id: "shipping",
                  label: "Shipping",
                  content: (
                    <p className="text-[15px] text-text-muted">
                      Metro Manila in 1 to 3 days. Free over ₱2,500.
                    </p>
                  ),
                },
                { id: "reviews", label: "Reviews", content: <Rating value={4.5} count={28} /> },
              ]}
            />
          </Card>
        </Section>

        <Section
          title="Accordion"
          note="Built on details/summary, so Ctrl+F finds collapsed content."
        >
          <Card className="p-0 md:p-0">
            <Accordion
              items={[
                {
                  id: "returns",
                  title: "Returns and refunds",
                  content: "Unused items can be returned within 30 days.",
                },
                {
                  id: "sizing",
                  title: "Sizing",
                  content: "Runs slightly large. Order one size down if between sizes.",
                },
                { id: "care", title: "Care", content: "Machine wash cold, hang dry." },
              ]}
            />
          </Card>
        </Section>

        <Section title="Navigation">
          <Card className="flex flex-col gap-6">
            <Breadcrumb
              items={[
                { label: "Home", href: "/" },
                { label: "Apparel", href: "/apparel" },
                { label: "Brotherhood polo shirt" },
              ]}
            />
            <Pagination current={5} total={20} hrefFor={(page) => `/dev/ui?page=${page}`} />
            <Pagination current={1} total={3} hrefFor={(page) => `/dev/ui?page=${page}`} />
          </Card>
        </Section>

        <Section
          title="PH address cascade"
          note="Region → province → city → barangay. Falls back to free text where the dataset has no entries — see lib/data/ph-locations.ts."
        >
          <Card>
            <AddressFields value={address} onChange={setAddress} />
            <pre className="mt-4 overflow-x-auto rounded-[var(--radius-ctrl)] bg-page p-3 text-xs">
              {JSON.stringify(address, null, 2)}
            </pre>
          </Card>
        </Section>

        <Section title="Empty and loading states">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-0 md:p-0">
              <EmptyState
                title="No orders yet"
                body="When you place your first order it will appear here with its tracking details."
                action={<Button>Start shopping</Button>}
                icon={
                  <svg viewBox="0 0 48 48" className="size-12" fill="none" aria-hidden="true">
                    <path
                      d="M8 14h32l-3 24H11L8 14z"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M18 14a6 6 0 0112 0"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                }
              />
            </Card>

            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <ProductCardSkeleton />
                <ProductCardSkeleton />
              </div>
              <Card className="p-0 md:p-0">
                <TableRowSkeleton />
                <TableRowSkeleton />
                <TableRowSkeleton />
              </Card>
              <Skeleton className="h-11 w-full" />
            </div>
          </div>
        </Section>
      </div>
    </main>
  );
}

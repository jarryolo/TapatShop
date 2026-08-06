# 05 — Design system

Blue and white. Generous space. Clear cards, clear pictures. The reference feeling is
Canva: bright, calm, obviously clickable, nothing cramped.

## Tokens

Define these once as CSS custom properties in `app/globals.css` and map them into the
Tailwind theme. Never hardcode a hex value in a component.

```css
:root {
  --brand-50:  #E6F1FB;
  --brand-100: #B5D4F4;
  --brand-200: #85B7EB;
  --brand-400: #378ADD;
  --brand-600: #185FA5;  /* primary */
  --brand-800: #0C447C;  /* hover / pressed */
  --brand-900: #042C53;

  --page:      #F7F8FA;  /* page background */
  --surface:   #FFFFFF;  /* cards */
  --border:    #E5E8EC;
  --border-strong: #CDD3DA;

  --text:      #10151C;
  --text-muted:#5B6672;
  --text-soft: #68727F;  /* was #8A94A0 — see "Contrast corrections" below */

  --success:   #1D9E75;
  --warning:   #BA7517;
  --danger:    #D14343;

  /* Darker same-family text for badges. See "Contrast corrections" below. */
  --success-text: #137055;
  --warning-text: #8A5510;
  --danger-text:  #A82F2F;

  --radius-card: 12px;
  --radius-ctrl: 8px;
  --shadow-card: 0 1px 2px rgba(16,21,28,.04), 0 4px 12px rgba(16,21,28,.06);
}
```

White cards on a very slightly grey page is what makes cards read as cards. Do not put
white cards on a white page and rely on borders alone.

### Contrast corrections

Four of the original values failed the WCAG AA rule this document sets, and were changed
during P1-04. Measured ratios are pinned in `apps/web/components/ui/tokens.test.ts` — change
a token to something that fails and the test suite goes red.

| Token | Was | Now | Why |
|---|---|---|---|
| `--text-soft` | `#8A94A0` | `#68727F` | 3.08:1 on white. It renders placeholders and compare-at prices, which are real text. Now 4.88:1. |
| `--success-text` | used `--success` | `#137055` | `#1D9E75` on its own pale fill is 3.04:1. Now 5.42:1. |
| `--warning-text` | used `--warning` | `#8A5510` | `#BA7517` on its own pale fill is 3.33:1. Now 5.54:1. |
| `--danger-text` | used `--danger` | `#A82F2F` | `#D14343` on its own pale fill is 3.93:1. Now 5.80:1. |

The base `--success` / `--warning` / `--danger` values are unchanged and still correct for
fills, icons, and borders — white on `--danger` is 4.57:1, so the danger button is fine. It
is only *text on the pale fill* that needed the darker variant.

## Type

Plus Jakarta Sans, or Inter as fallback. Two weights only: 400 and 600.

| Role | Mobile | Desktop |
|---|---|---|
| Display | 28/1.2 600 | 44/1.1 600 |
| H1 | 24/1.25 600 | 32/1.2 600 |
| H2 | 20/1.3 600 | 24/1.3 600 |
| H3 | 17/1.4 600 | 18/1.4 600 |
| Body | 15/1.6 400 | 16/1.6 400 |
| Small | 13/1.5 400 | 14/1.5 400 |
| Caption | 12/1.4 400 | 12/1.4 400 |

Sentence case everywhere, including buttons and headings. Never ALL CAPS except a single
optional eyebrow label at 11px with letter-spacing.

## Spacing

8px base scale: 4, 8, 12, 16, 24, 32, 48, 64, 96.

- Card padding: 16px mobile, 24px desktop
- Grid gap: 12px mobile, 24px desktop
- Section vertical rhythm: 32px mobile, 64px desktop
- Page gutter: 16px mobile, 24px tablet, max content width 1280px centred

The single most common mistake will be under-spacing. When in doubt, go one step up the
scale.

## Components to build in `components/ui`

Each needs all states: default, hover, active, focus-visible, disabled, loading.

- `Button` — variants `primary` (brand-600 fill, white text), `secondary` (white fill,
  border), `ghost`, `danger`. Sizes sm/md/lg. Never more than one primary per view.
- `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch` — 44px min touch target,
  visible focus ring (`0 0 0 3px var(--brand-100)`), error state with message below
- `Card` — white, 12px radius, `--shadow-card`, no border by default
- `Badge` — `success` / `warning` / `danger` / `neutral` / `brand`, pale fill with the
  darker same-family text. Never black text on a colour fill.
- `Price` — handles centavos → `₱1,234.50`, strikethrough compare-at, member price
- `Rating` — stars, read-only and input modes
- `Sheet` / `Drawer` — cart drawer, mobile filters
- `Modal`, `Toast`, `Tabs`, `Accordion`, `Pagination`, `Breadcrumb`
- `EmptyState` — icon, headline, one line of body, one action
- `Skeleton` — for product cards, product detail, and tables

## Product card

The single most-repeated element. Get it right once.

- Square 1:1 image, `object-fit: cover`, on a white background
- Stock badge top-left when stock is at or below the low threshold ("3 left"), warning tint
- Name: 2 lines max, `line-clamp-2`
- Price row: current price 600 weight; compare-at struck through in muted text beside it
- Full-width "Add to cart" button on mobile; on desktop it may appear on hover
- Entire card is a link; the button is a nested action — handle the click properly

## Imagery rules

Enforce at upload, not by asking nicely:

- Accept JPEG, PNG, WebP. Max 5 MB. Minimum 1000×1000.
- Auto-crop to 1:1, convert to WebP, generate 200/400/800/1600 widths.
- White or near-white background required for catalog shots.
- Every image needs alt text; block publishing a product whose primary image has none.

Inconsistent product photography is the fastest way to make a store look untrustworthy.
This matters more than any code in the repo.

## Layout patterns

**Home** — hero banner, category tiles (4 across desktop, 2 mobile, scrollable chips on
small screens), featured grid, new arrivals, trust strip (secure payment, shipping, returns).

**Category** — breadcrumb, title, result count, filter rail on desktop / filter sheet on
mobile, 4-column grid desktop, 2-column mobile.

**Product detail** — gallery left (sticky on desktop), buy box right: name, price, variant
picker, stock line, quantity stepper, add to cart, delivery estimate. Description and
reviews below in tabs.

**Checkout** — single column, max 560px, visible 3-step progress, order summary collapsible
on mobile and sticky on desktop. Remove the site nav; keep only the logo and a back link.

**Admin** — left sidebar nav, dense tables, sticky filter bar, right-side detail drawer
for quick edits. Density here is a feature; the spacious storefront rules do not apply.

## Accessibility

WCAG AA. 4.5:1 contrast for body text. `--brand-600` on white passes; `--brand-400` does
not — never use it for text. Every interactive element reachable by keyboard with a visible
focus ring. Form errors linked with `aria-describedby`. Cart and stock changes announced
via a live region.

## Motion

150–200ms, ease-out. Fade and small translate only. No parallax, no scroll-jacking, no
bouncing. Respect `prefers-reduced-motion`.

## Copy voice

Honest and plain. "Only 3 left" when it's true, never as a manipulation. No countdown
timers. No "Hurry!". No exclamation marks in system messages. Errors say what happened and
what to do: "That coupon has expired. Try another code."

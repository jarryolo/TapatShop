import Link from "next/link";
import type { ReactNode } from "react";

import { CartButton, CartDrawer } from "@/components/shop/cart-drawer";
import { CartProvider } from "@/components/shop/cart-provider";
import { SearchBox } from "@/components/shop/search-box";
import { readCart } from "@/lib/cart-session";
import { auth } from "@/lib/auth";
import { listCategories } from "@/lib/services/catalog.service";

export default async function ShopLayout({ children }: { children: ReactNode }) {
  // The cart is read on the server so the first paint already has the right count — a badge
  // that appears a beat late looks like the cart lost something.
  const [categories, session, cart] = await Promise.all([listCategories(), auth(), readCart()]);
  const topLevel = categories.filter((c) => !c.parentId && c._count.products > 0);

  return (
    <CartProvider
      initialCart={cart}
      isMember={cart.isMember}
      isAuthenticated={Boolean(session?.user)}
    >
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only-live focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-2 focus:shadow-[var(--shadow-card)]"
        >
          Skip to content
        </a>

        <header className="border-b border-border-subtle bg-surface">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-4 px-4 py-3 md:px-6">
            <Link href="/" className="text-lg font-semibold">
              TapatShop
            </Link>

            <nav aria-label="Categories" className="order-3 w-full md:order-none md:w-auto">
              <ul className="flex gap-1 overflow-x-auto md:gap-2">
                <li>
                  <Link
                    href="/products"
                    className="inline-flex min-h-11 items-center whitespace-nowrap rounded-[var(--radius-ctrl)] px-3 text-[15px] text-text-muted hover:bg-page hover:text-text"
                  >
                    All products
                  </Link>
                </li>
                {topLevel.map((category) => (
                  <li key={category.id}>
                    <Link
                      href={`/c/${category.slug}`}
                      className="inline-flex min-h-11 items-center whitespace-nowrap rounded-[var(--radius-ctrl)] px-3 text-[15px] text-text-muted hover:bg-page hover:text-text"
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="order-2 min-w-0 flex-1 md:order-none md:ml-4">
              <SearchBox />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <CartButton />
              {session?.user ? (
                <Link
                  href="/account"
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-ctrl)] px-3 text-[15px] font-semibold text-brand-600 hover:bg-brand-50"
                >
                  {session.user.name?.split(" ")[0] ?? "Account"}
                </Link>
              ) : (
                <Link
                  href="/signin"
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-ctrl)] px-3 text-[15px] font-semibold text-brand-600 hover:bg-brand-50"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>

        <footer className="mt-16 border-t border-border-subtle bg-surface">
          <div className="mx-auto flex max-w-[1280px] flex-wrap gap-8 px-4 py-8 text-sm md:px-6">
            <div className="min-w-48 flex-1">
              <p className="font-semibold">TapatShop</p>
              <p className="mt-1 text-text-muted">
                Honest goods from the brotherhood. Clear prices, no fake urgency.
              </p>
            </div>
            <nav aria-label="Footer" className="min-w-40">
              <ul className="flex flex-col gap-2 text-text-muted">
                <li>
                  <Link href="/orders/track" className="hover:text-brand-600">
                    Track an order
                  </Link>
                </li>
                <li>
                  <Link href="/returns" className="hover:text-brand-600">
                    Returns and refunds
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="hover:text-brand-600">
                    Privacy policy
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="hover:text-brand-600">
                    Terms
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </footer>

        <CartDrawer />
      </div>
    </CartProvider>
  );
}

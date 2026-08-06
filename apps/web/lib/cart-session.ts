import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { auth } from "@/lib/auth";
import { memberDiscountPercent } from "@/lib/services/catalog.service";
import {
  CART_TTL_DAYS,
  type CartIdentity,
  type PricedCart,
  EMPTY_CART,
  findCartId,
  getOrCreateCart,
  priceCart,
} from "@/lib/services/cart.service";
import { db } from "@/lib/db";

/**
 * Who the cart belongs to, from the session and the guest cookie.
 *
 * docs/04 names the cookie `tapat_cart`; the mobile app sends the same value as an
 * `X-Cart-Token` header instead, since it has no cookie jar.
 */
export const CART_COOKIE = "tapat_cart";

/** httpOnly so no script can read it. It identifies a basket, not a session, but the same
 *  reasoning applies: nothing in the browser needs to see it. */
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: CART_TTL_DAYS * 24 * 60 * 60,
} as const;

export function newGuestToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface CartContext {
  identity: CartIdentity;
  memberPercent: number;
  isMember: boolean;
}

/** Reads the session and cookie. Never writes — safe in a Server Component. */
export async function readCartContext(request?: Request): Promise<CartContext> {
  const session = await auth();
  const jar = await cookies();

  const headerToken = request?.headers.get("x-cart-token") ?? null;
  const guestToken = headerToken ?? jar.get(CART_COOKIE)?.value ?? null;

  const isMember = Boolean(session?.user?.isMember && session.user.emailIsVerified);
  const memberPercent = isMember ? await memberDiscountPercent() : 0;

  return {
    identity: { userId: session?.user?.id ?? null, guestToken },
    memberPercent,
    isMember,
  };
}

/** The current cart, priced. Returns an empty cart rather than creating one for a look. */
export async function readCart(request?: Request): Promise<PricedCart & { isMember: boolean }> {
  const context = await readCartContext(request);

  if (!context.identity.userId && !context.identity.guestToken) {
    return { ...EMPTY_CART, isMember: context.isMember };
  }

  const cartId = await findCartId(db, context.identity);
  const priced = await priceCart(db, cartId, context.memberPercent);
  return { ...priced, isMember: context.isMember };
}

/**
 * The cart to write into, creating one — and a guest cookie — if needed.
 *
 * Only route handlers may call this: a Server Component cannot set a cookie, and a browsing
 * guest should not be issued a cart just for looking at a page.
 */
export async function requireWritableCart(request?: Request): Promise<{
  cartId: string;
  memberPercent: number;
}> {
  const context = await readCartContext(request);
  const jar = await cookies();

  let { guestToken } = context.identity;

  if (!context.identity.userId && !guestToken) {
    guestToken = newGuestToken();
    jar.set(CART_COOKIE, guestToken, COOKIE_OPTIONS);
  }

  const cartId = await getOrCreateCart(db, { ...context.identity, guestToken });

  // Re-set on every write so an active shopper's 30 days rolls forward.
  if (!context.identity.userId && guestToken) {
    jar.set(CART_COOKIE, guestToken, COOKIE_OPTIONS);
  }

  return { cartId, memberPercent: context.memberPercent };
}

export async function clearGuestCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(CART_COOKIE);
}

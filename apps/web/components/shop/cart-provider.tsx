"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useToast } from "@/components/ui/toast";
import type { PricedCart } from "@/lib/services/cart.service";

interface CartContextValue {
  cart: PricedCart;
  isMember: boolean;
  pending: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (variantId: string, quantity: number) => Promise<void>;
  update: (itemId: string, quantity: number) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside a CartProvider");
  return context;
}

interface ApiResponse {
  data: PricedCart & { isMember?: boolean };
  message?: string;
  error?: { message?: string };
}

export function CartProvider({
  children,
  initialCart,
  isMember,
  isAuthenticated,
}: {
  children: ReactNode;
  initialCart: PricedCart;
  isMember: boolean;
  isAuthenticated: boolean;
}) {
  const { toast } = useToast();
  const [cart, setCart] = useState<PricedCart>(initialCart);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const mergeAttempted = useRef(false);

  const call = useCallback(
    async (url: string, init: RequestInit): Promise<ApiResponse | null> => {
      setPending(true);
      try {
        const response = await fetch(url, {
          headers: { "Content-Type": "application/json" },
          ...init,
        });
        const payload = (await response.json()) as ApiResponse;

        if (!response.ok) {
          toast(payload.error?.message ?? "Something went wrong.", "error");
          return null;
        }

        setCart(payload.data);
        // Clamp messages arrive here and are shown, never swallowed.
        if (payload.message) toast(payload.message, "info");
        return payload;
      } catch {
        toast("Could not reach the server. Try again.", "error");
        return null;
      } finally {
        setPending(false);
      }
    },
    [toast]
  );

  const refresh = useCallback(async () => {
    const response = await fetch("/api/v1/cart");
    if (!response.ok) return;
    const payload = (await response.json()) as ApiResponse;
    setCart(payload.data);
  }, []);

  /**
   * Merge the guest cart once per signed-in page load.
   *
   * This runs here rather than in the sign-in form because Google sign-in never touches that
   * form — it returns from a provider redirect. The endpoint is a no-op without a guest
   * cookie, so calling it on every load is cheap and covers both paths.
   */
  useEffect(() => {
    if (!isAuthenticated || mergeAttempted.current) return;
    mergeAttempted.current = true;

    void (async () => {
      const response = await fetch("/api/v1/cart/merge", { method: "POST" });
      if (!response.ok) return;
      const payload = (await response.json()) as ApiResponse & { merged: number };
      setCart(payload.data);
      if (payload.merged > 0) {
        toast(
          payload.message ?? `Your basket has been added to your account.`,
          payload.message ? "info" : "success"
        );
      }
    })();
  }, [isAuthenticated, toast]);

  const add = useCallback(
    async (variantId: string, quantity: number) => {
      const result = await call("/api/v1/cart/items", {
        method: "POST",
        body: JSON.stringify({ variantId, quantity }),
      });
      if (result) setOpen(true);
    },
    [call]
  );

  const update = useCallback(
    async (itemId: string, quantity: number) => {
      await call(`/api/v1/cart/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
      });
    },
    [call]
  );

  const remove = useCallback(
    async (itemId: string) => {
      await call(`/api/v1/cart/items/${itemId}`, { method: "DELETE" });
    },
    [call]
  );

  const value = useMemo(
    () => ({ cart, isMember, pending, open, setOpen, add, update, remove, refresh }),
    [cart, isMember, pending, open, add, update, remove, refresh]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

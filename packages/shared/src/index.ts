/**
 * Types and Zod schemas shared between the web app and the future mobile app.
 *
 * Anything the mobile app will need to parse or construct belongs here, not in `apps/web`.
 * Real schemas arrive with the endpoints that use them; see docs/04-api-spec.md.
 */

/** Every monetary value in the system is an integer count of centavos. ₱480.00 is 48000. */
export type Cents = number;

/**
 * Mirrors the `Role` enum in the Prisma schema.
 *
 * Declared here rather than imported from @tapatshop/db so that client components and the
 * future mobile app can talk about roles without pulling the Prisma client into the bundle.
 * If the schema enum changes, change this too.
 */
export type Role = "customer" | "staff" | "admin";

/** The error body every `/api/v1` route returns on failure. See docs/04-api-spec.md. */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "OUT_OF_STOCK"
  | "CART_STALE"
  | "RATE_LIMITED"
  | "PAYMENT_FAILED"
  | "INTERNAL";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

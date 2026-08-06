import { handlers } from "@/lib/auth";

/** Auth.js endpoints: sign in, callbacks, CSRF, session. Excluded from middleware. */
export const { GET, POST } = handlers;

/**
 * Security response headers — P5-03.
 *
 * The Content-Security-Policy is nonce-based rather than `'unsafe-inline'`. That distinction is
 * the whole value of having one: a policy that permits arbitrary inline script stops almost no
 * XSS, and shipping it would let this checklist item be ticked without buying anything.
 *
 * `'strict-dynamic'` lets a nonced script load the chunks Next requests at runtime without
 * enumerating them, and modern browsers ignore the host allowlist when it is present. The
 * `https:` fallback is there for browsers that do not support strict-dynamic.
 */

/** A fresh nonce per request. Reusing one across requests defeats the point of having it. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const directives = [
    `default-src 'self'`,
    /**
     * Dev needs 'unsafe-eval' — the React refresh runtime and the dev overlay both use it.
     * Production does not, and must not: eval is the single most useful primitive an injected
     * string can reach for.
     */
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:${isDev ? " 'unsafe-eval'" : ""}`,
    /**
     * Styles keep 'unsafe-inline'. Next injects inline <style> for its font and CSS handling
     * with no nonce, and nothing here can change that. The exposure is style injection —
     * defacement rather than code execution — which is the trade being accepted knowingly.
     */
    `style-src 'self' 'unsafe-inline'`,
    // Product images come from S3-compatible storage; data: covers the inline SVG icons.
    `img-src 'self' data: blob: https: http://localhost:9000`,
    `font-src 'self' data:`,
    // PayMongo is called server-side only, so the browser never needs to reach it.
    `connect-src 'self'${isDev ? " ws: http://localhost:*" : ""}`,
    // Payment happens on PayMongo's own page via a redirect, never in a frame here.
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // Checkout posts to this origin only; PayMongo is reached by redirect, not by form post.
    `form-action 'self'`,
    // Nothing on this site should ever be framed. Belt and braces with X-Frame-Options.
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ];

  return directives.join("; ");
}

/**
 * The rest of the headers, none of which need a nonce.
 *
 * HSTS is only meaningful over HTTPS and would be actively unhelpful on a local HTTP dev
 * server — a browser that pins localhost to HTTPS stays broken until the user clears it.
 */
export function securityHeaders(isDev: boolean): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    /**
     * Nothing here uses a camera, microphone, or location, and an XSS that could turn one on
     * is worse than one that cannot. `interest-cohort` opts out of topic-based ad tracking.
     */
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "X-DNS-Prefetch-Control": "off",
    ...(isDev
      ? {}
      : {
          "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
        }),
  };
}

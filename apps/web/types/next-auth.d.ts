import type { Role } from "@tapatshop/shared";
import type { DefaultSession } from "next-auth";

// Both modules must be imported for the augmentations below to attach to them.
import "next-auth";
import "next-auth/jwt";

/**
 * Session and token shape.
 *
 * Note `emailIsVerified` rather than `emailVerified`: next-auth's own `User` already declares
 * `emailVerified` as a `Date`, and augmenting it with a boolean produces the uninhabitable
 * type `Date & boolean`. Different name, no collision.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      emailIsVerified: boolean;
      isMember: boolean;
      /**
       * The user's `sessionsRevokedAt` as of when this token was issued, in epoch ms.
       *
       * Guards compare it against the live column: if the stored value has moved past this
       * one, the token was issued before a revocation and is dead. Carrying it here avoids
       * needing the JWT's `iat`, which `auth()` does not expose.
       */
      revocationStamp: number;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
    emailIsVerified?: boolean;
    isMember?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    emailIsVerified: boolean;
    isMember: boolean;
    revocationStamp: number;
  }
}

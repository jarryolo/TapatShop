import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts, last one winning.
 *
 * Without the merge step, `<Button className="px-8">` would emit both `px-4` and `px-8` and
 * the winner would depend on stylesheet order rather than on what the caller asked for.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

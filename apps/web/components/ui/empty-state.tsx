import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Icon, headline, one line of body, one action — docs/05. Resist adding a second action:
 * an empty state with three choices is a menu, not an answer.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-4 text-text-soft">{icon}</div> : null}
      <h3 className="text-[17px] font-semibold md:text-lg">{title}</h3>
      {body ? <p className="mt-1 max-w-sm text-sm text-text-muted">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

import type { ReactNode } from "react";
import { LinkButton } from "./button";

export type EmptyStateAction = {
  href: string;
  label: string;
};

/**
 * Reusable, on-brand empty/placeholder state — icon slot, title,
 * description, and an optional real styled action (never a bare text
 * link). Replaces one-off inline empty-state markup (the old `.feed-empty`
 * paragraph with a plain "Back home" link, owner-flagged as tacky) with a
 * single shared primitive so every honest "there's nothing here yet"
 * surface in the app reads the same deliberate way.
 *
 * Reuses the existing dashed-border/`--paper-2` register already
 * established by `.feed-empty` and `.advisory-card`'s own empty/
 * unavailable states (globals.css) — this is a consolidation, not a new
 * visual language.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`empty-state ${className}`.trim()} role="status">
      {icon && (
        <span className="empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-body">{description}</p>}
      {action && (
        <LinkButton href={action.href} variant="ghost" className="empty-state-action">
          {action.label}
        </LinkButton>
      )}
    </div>
  );
}

import type { ComponentType, ReactNode } from "react";

type IconLike = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;

/** Icon in a ring + one short title, optional hint line and action (a <Link className="btn"> or <button>). */
export function EmptyState({ icon: Icon, title, hint, action, className = "" }: {
  icon: IconLike;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`empty-state ${className}`.trim()}>
      <span className="empty-state-icon"><Icon size={28} strokeWidth={1.5} aria-hidden /></span>
      <p className="empty-state-title">{title}</p>
      {hint && <p className="empty-state-hint">{hint}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

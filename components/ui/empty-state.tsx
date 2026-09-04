import { cn } from "@/lib/cn";

/**
 * Empty state.
 *
 * Worth a primitive because an admin console has two very different kinds of
 * "nothing here", and conflating them wastes support time: either the platform
 * genuinely has no such records yet, or the current filters excluded
 * everything. `hint` is where that distinction gets stated in words.
 *
 * Note there is no illustration or icon: SRS §30 forbids emoji as decoration,
 * and no icon set is bundled in the project. Plain type is the honest choice.
 */
export function EmptyState({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-brand border border-dashed border-cream-300 bg-cream-50 px-5 py-10 text-center",
        className
      )}
    >
      <p className="font-display text-sm font-semibold text-ink">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">{hint}</p> : null}
      {children ? <div className="mt-4 flex justify-center">{children}</div> : null}
    </div>
  );
}

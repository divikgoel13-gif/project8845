import { forwardRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Form field primitives.
 *
 * Phase 6's components/admin/disburse-form.tsx established the input styling
 * inline ("mt-1 block w-full rounded-brand border border-cream-300 ..."), and
 * Phases 7-9 add roughly sixty forms. Repeating that string sixty times
 * guarantees drift, so it lives here once. The visual result is identical to
 * the Phase 6 forms — this is extraction, not a redesign.
 *
 * Accessibility: `Field` wires label → control via a caller-supplied `htmlFor`
 * / `id` pair rather than generating one, because server components render
 * these and a generated id would differ between server and client renders.
 * Every call site must pass an id; the label is not optional.
 */

const CONTROL =
  "mt-1 block w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-muted focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200 " +
  "disabled:opacity-60";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-xs font-semibold text-ink-soft", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("w-full", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(CONTROL, className)} {...props} />
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 4, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(CONTROL, "resize-y", className)} {...props} />
  )
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(CONTROL, "pr-8", className)} {...props} />
);
Select.displayName = "Select";

/** Inline checkbox with its own label; used for boolean settings and flags. */
export function Checkbox({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm text-ink-soft", className)}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-cream-400 text-orange-500 focus:ring-orange-200"
        {...props}
      />
      {label}
    </label>
  );
}

/** Standard inline form feedback, matching the Phase 6 forms' conventions. */
export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-xs text-danger">{children}</p>;
}

export function FormSuccess({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-xs text-success">{children}</p>;
}

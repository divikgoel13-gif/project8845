import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Use this instead of raw `clsx()` anywhere a component accepts a
 * caller-supplied `className` alongside its own defaults — e.g. `Card`'s
 * default `border-cream-300` vs. a caller passing `border-danger` to flag
 * an error state. Plain `clsx()` just concatenates both class names, and
 * which one actually wins in the compiled CSS depends on Tailwind's
 * internal source order, not the order they appear in the string — that's
 * a real, easy-to-miss bug. `twMerge` resolves same-property conflicts
 * (last one wins, as the caller would expect) before clsx's conditional
 * logic runs.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

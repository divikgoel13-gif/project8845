import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-brand border border-cream-300 bg-cream-50 p-5 shadow-sm",
        className
      )}
      {...props}
    />
  );
}

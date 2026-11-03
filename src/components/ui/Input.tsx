import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full h-10 rounded-lg bg-bg border border-border px-3 text-[15px] md:text-[14px] text-fg placeholder:text-muted",
        "outline-none transition-colors focus:border-muted/70 focus:ring-2 focus:ring-fg/10",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

/** `plain` renders a div instead of a label - for fields whose control is a set of
 *  buttons, where wrapping in a label would forward clicks back into the control. */
export function Field({ label, hint, children, plain }: { label: string; hint?: string; children: React.ReactNode; plain?: boolean }) {
  const Tag = plain ? "div" : "label";
  return (
    <Tag className="flex flex-col gap-2">
      <span className="text-[14px] font-medium text-fg">
        {label} {hint && <span className="text-[12px] font-normal text-muted">{hint}</span>}
      </span>
      {children}
    </Tag>
  );
}

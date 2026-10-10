import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "success";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground",
  outline: "border border-border text-foreground",
  success: "bg-emerald-600 text-white",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-xs font-medium tabular-nums",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

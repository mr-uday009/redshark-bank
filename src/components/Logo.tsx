import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Redshark Bank brand lockup.
 *
 * `mark`  — the shark alone, for compact headers
 * `full`  — shark plus the "Redshark" wordmark, for auth screens
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/redshark-mark.png"
      alt="Redshark Bank"
      width={256}
      height={256}
      priority
      className={cn("h-9 w-9 object-contain", className)}
    />
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <Image
      src="/redshark-logo.png"
      alt="Redshark Bank"
      width={399}
      height={240}
      priority
      className={cn("h-20 w-auto object-contain", className)}
    />
  );
}

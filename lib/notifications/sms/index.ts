import "server-only";
import type { SmsProvider } from "@/lib/notifications/sms/types";
import { consoleSmsProvider } from "@/lib/notifications/sms/console-provider";

/**
 * Selects the active SMS provider from SMS_PROVIDER (.env.example).
 * Currently only "console" (the safe dev default) is implemented — no
 * real India SMS provider has been selected/integrated yet (SRS §Y: that
 * selection is a documented pre-production decision, not a Phase 3
 * foundation task). When that provider is chosen, add a new file here
 * (e.g. msg91-provider.ts) implementing the same SmsProvider interface
 * and add its case below — nothing in lib/notifications/send.ts or any
 * business-logic caller needs to change.
 */
export function getSmsProvider(): SmsProvider {
  const configured = process.env.SMS_PROVIDER;

  switch (configured) {
    case undefined:
    case "unset":
    case "console":
      return consoleSmsProvider;
    default:
      console.warn(`[sms] SMS_PROVIDER="${configured}" has no implementation yet — falling back to console.`);
      return consoleSmsProvider;
  }
}

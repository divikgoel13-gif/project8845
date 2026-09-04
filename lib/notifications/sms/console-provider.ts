import "server-only";
import type { SmsProvider, SmsSendResult } from "@/lib/notifications/sms/types";

/**
 * Dev/staging default: logs what WOULD have been sent instead of calling
 * a real SMS API. This is the safe fallback whenever SMS_PROVIDER is
 * unset (see .env.example) — never silently fails, never accidentally
 * texts a real phone number from a dev environment, and gives the
 * `notifications` table real rows to inspect during development.
 */
export const consoleSmsProvider: SmsProvider = {
  name: "console",
  async send({ toPhone, templateId, variables }): Promise<SmsSendResult> {
    console.log(`[sms:console] would send "${templateId}" to ${toPhone}`, variables);
    return { providerMessageId: `console-${Date.now()}`, status: "sent" };
  },
};

/**
 * SMS provider abstraction (SRS V2 §E.1: "The provider integration must
 * be behind an internal SMS/notification service interface so UNI8 can
 * switch providers without changing order business logic."). Business
 * logic (lib/orders/finalize-payment.ts, and future Phase 5/6 code for
 * pickup reminders, ready-for-pickup, cancellations) only ever calls
 * lib/notifications/send.ts#sendNotification — never a provider
 * implementation directly.
 *
 * SRS §Y is explicit that the actual provider selection is a documented
 * decision the implementation team makes before production, evaluated
 * against DLT/TRAI compliance, delivery reliability, API quality,
 * pricing, support, and scalability — NOT something to lock in during
 * foundational scaffolding. This file defines the interface; no real
 * provider is wired up yet (see console-provider.ts).
 */
export type SmsSendResult = {
  providerMessageId: string | null;
  status: "sent" | "failed";
  errorMessage?: string;
};

export interface SmsProvider {
  readonly name: string;
  send(params: { toPhone: string; templateId: string; variables: Record<string, string> }): Promise<SmsSendResult>;
}

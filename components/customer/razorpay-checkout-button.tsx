"use client";

import { useState } from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { initiateRazorpayCheckout } from "@/lib/actions/customer/checkout";
import { verifyPaymentAndGetOrders } from "@/lib/actions/customer/verify-payment";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

/**
 * Loads Razorpay's Checkout.js and drives the customer payment flow (SRS
 * §9 Payment, Phase 3). This component only ORCHESTRATES — it never
 * computes a price or decides an order is valid; `initiateRazorpayCheckout`
 * and `verifyPaymentAndGetOrders` (both Server Actions) do all of that
 * server-side. The browser's only job here is opening Razorpay's own
 * widget and reporting back what Razorpay told it, which the server then
 * independently re-verifies (see verify-payment.ts's doc comment).
 *
 * UNTESTED: this has not been run against a real Razorpay test-mode
 * checkout in this environment (no network access). The options shape
 * matches Razorpay's documented Checkout.js integration; treat as
 * carefully-researched but unverified — see docs/PAYMENTS.md.
 */
export function RazorpayCheckoutButton({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [scriptReady, setScriptReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setError(null);
    setLoading(true);

    const initiated = await initiateRazorpayCheckout(groupId);
    if (!initiated.ok) {
      setLoading(false);
      setError(initiated.issues.join(" "));
      return;
    }

    if (!scriptReady || typeof window.Razorpay === "undefined") {
      setLoading(false);
      setError("Payment isn't ready yet — please try again in a moment.");
      return;
    }

    const rzp = new window.Razorpay({
      key: initiated.keyId,
      amount: initiated.amountPaise,
      currency: "INR",
      name: "UNI8",
      description: "Campus food order",
      order_id: initiated.razorpayOrderId,
      prefill: {
        name: initiated.customerName ?? undefined,
        email: initiated.customerEmail ?? undefined,
        contact: initiated.customerPhone ?? undefined,
      },
      theme: { color: "#EF7D18" }, // brand orange — see tailwind.config.ts
      handler: async (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        const verified = await verifyPaymentAndGetOrders({
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        });

        setLoading(false);

        if (!verified.ok) {
          // Payment likely still succeeded (Razorpay confirmed it client-side) —
          // the webhook will finalize it shortly even if this fast-path
          // verification hit a transient error. Send the customer to their
          // orders list rather than leaving them stuck on checkout.
          router.push("/orders?justPaid=1");
          return;
        }

        router.push(`/orders?justPaid=1`);
      },
      modal: {
        ondismiss: () => setLoading(false),
      },
    });

    rzp.open();
  }

  return (
    <div>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        onLoad={() => setScriptReady(true)}
        strategy="afterInteractive"
      />
      <Button onClick={handlePay} disabled={loading}>
        {loading ? "Opening payment..." : "Continue to payment"}
      </Button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

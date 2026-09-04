"use client";

import { useRef, useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  submitScan,
  searchCollectibleOrdersByPhone,
  submitFallbackCollection,
} from "@/lib/actions/restaurant/scan";
import type { CollectibleOrderForFallback } from "@/lib/orders/scan";

/**
 * Primary scan input is a plain text field, not a camera viewfinder.
 * This is a deliberate choice, not a shortcut: commercial QR/barcode
 * scanner hardware near-universally emulates keyboard input (scan → text
 * appears → Enter fires), which is standard in real F&B pickup counters
 * — so a focused text input IS the normal production scan UX for that
 * hardware, not just a fallback. It's also the same input a staff member
 * would use to manually type a code if a customer's camera-scan genuinely
 * fails. A camera-based live decode (getUserMedia + jsQR or similar) is a
 * pure UI enhancement that could sit in front of this same
 * `submitScan` action later — see docs/KNOWN_ISSUES.md; it wasn't added
 * here because it couldn't be tested in this sandbox (no camera, no
 * browser) and this input already fully implements the underlying
 * SRS §15 QR security/collection requirements.
 */
export function ScanForm({ restaurantId }: { restaurantId: string }) {
  const [token, setToken] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const [showFallback, setShowFallback] = useState(false);

  function handleScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setResult(null);
    startTransition(async () => {
      const outcome = await submitScan({ restaurantId, qrToken: token.trim() });
      setResult(outcome.ok ? { ok: true, message: `Collected — ${outcome.restaurantName}.` } : { ok: false, message: outcome.error });
      setToken("");
      inputRef.current?.focus();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form onSubmit={handleScanSubmit} className="flex flex-col gap-3">
          <label htmlFor="qr-token" className="text-sm font-medium">
            Scan or enter pickup code
          </label>
          <input
            ref={inputRef}
            id="qr-token"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Scan QR or type code"
            className="rounded-brand border border-cream-300 bg-cream-50 px-4 py-3 text-lg tracking-wide"
          />
          <Button type="submit" disabled={isPending || !token.trim()}>
            {isPending ? "Checking..." : "Confirm pickup"}
          </Button>
        </form>
        {result && (
          <p className={`mt-3 rounded-brand px-3 py-2 text-sm ${result.ok ? "bg-success-bg text-success" : "bg-danger-bg text-danger"}`}>
            {result.message}
          </p>
        )}
      </Card>

      <button
        type="button"
        onClick={() => setShowFallback((v) => !v)}
        className="self-start text-sm font-medium text-orange-600 underline"
      >
        {showFallback ? "Hide" : "Customer can't show their code?"}
      </button>

      {showFallback && <FallbackLookup restaurantId={restaurantId} />}
    </div>
  );
}

function FallbackLookup({ restaurantId }: { restaurantId: string }) {
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<CollectibleOrderForFallback[]>([]);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (phone.trim().length < 3) return;
    startTransition(async () => {
      const results = await searchCollectibleOrdersByPhone({ restaurantId, phoneQuery: phone.trim() });
      setMatches(results);
    });
  }

  function handleConfirm() {
    if (!selected || reason.trim().length < 3) return;
    startTransition(async () => {
      const outcome = await submitFallbackCollection({ restaurantId, orderId: selected, reason: reason.trim() });
      setMessage(outcome.ok ? { ok: true, text: `Collected — ${outcome.restaurantName}.` } : { ok: false, text: outcome.error });
      if (outcome.ok) {
        setMatches((m) => m.filter((o) => o.orderId !== selected));
        setSelected(null);
        setReason("");
      }
    });
  }

  return (
    <Card>
      <p className="text-sm text-ink-soft">
        Look up the order by the customer's phone number instead. Every use is logged with a reason
        (SRS V2 §K).
      </p>
      <form onSubmit={handleSearch} className="mt-3 flex gap-2">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Customer phone number"
          className="flex-1 rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
        />
        <Button type="submit" variant="secondary" disabled={isPending}>
          Search
        </Button>
      </form>

      {matches.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {matches.map((m) => (
            <label
              key={m.orderId}
              className="flex items-center gap-2 rounded-brand border border-cream-300 px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="fallback-order"
                checked={selected === m.orderId}
                onChange={() => setSelected(m.orderId)}
              />
              <span>
                {m.customerName ?? "Customer"} · {m.customerPhone} ·{" "}
                {m.pickupTime &&
                  new Date(m.pickupTime).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" })}
              </span>
            </label>
          ))}

          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (e.g. customer's phone is dead)"
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
          />
          <Button
            onClick={handleConfirm}
            disabled={isPending || !selected || reason.trim().length < 3}
            variant="danger"
          >
            Confirm collection without code
          </Button>
        </div>
      )}

      {message && (
        <p className={`mt-3 rounded-brand px-3 py-2 text-sm ${message.ok ? "bg-success-bg text-success" : "bg-danger-bg text-danger"}`}>
          {message.text}
        </p>
      )}
    </Card>
  );
}

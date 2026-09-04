"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

/**
 * Customer authentication — phone number + OTP, per SRS §1.1/§9. No email
 * or password for customers. First-time onboarding (name, email, course)
 * happens on /auth/customer/onboarding after the OTP is verified, only if
 * the profile doesn't have a name yet.
 *
 * This talks to Supabase Auth directly from the browser (anon key) —
 * that's the intended pattern for OTP request/verify, not a Server Action,
 * since Supabase Auth itself is the trust boundary for OTP correctness.
 */
export default function CustomerAuthPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [phase, setPhase] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({ phone });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setPhase("otp");
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token: code,
      type: "sms",
    });

    if (error || !data.session) {
      setLoading(false);
      setError(error?.message ?? "Could not verify code.");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", data.session.user.id)
      .single();

    setLoading(false);
    router.push(profile?.name ? "/" : "/auth/customer/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-6">
      <Logo />
      {phase === "phone" ? (
        <form onSubmit={requestOtp} className="flex w-full flex-col gap-3">
          <label htmlFor="phone" className="text-sm font-medium text-ink-soft">
            Phone number
          </label>
          <input
            id="phone"
            type="tel"
            required
            placeholder="+91XXXXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-brand border border-cream-300 bg-cream-50 px-4 py-2.5"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Sending..." : "Send code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="flex w-full flex-col gap-3">
          <label htmlFor="code" className="text-sm font-medium text-ink-soft">
            Enter the code sent to {phone}
          </label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded-brand border border-cream-300 bg-cream-50 px-4 py-2.5 tracking-widest"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Verifying..." : "Verify & continue"}
          </Button>
        </form>
      )}
    </main>
  );
}

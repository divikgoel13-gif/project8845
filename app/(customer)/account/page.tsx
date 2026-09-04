import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";

/**
 * Customer account placeholder. Full profile/orders/ratings build-out is
 * Phase 2–3. Route protection for /account is handled in middleware.ts;
 * this still re-checks the session server-side per SRS §17 defense in depth.
 */
export default async function AccountPage() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/customer");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, phone, email, course")
    .eq("id", user.id)
    .single();

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <h1 className="text-2xl font-bold">Your account</h1>
      <Card className="mt-6 flex flex-col gap-2 text-sm">
        <p><span className="text-ink-muted">Name:</span> {profile?.name}</p>
        <p><span className="text-ink-muted">Phone:</span> {profile?.phone}</p>
        <p><span className="text-ink-muted">Email:</span> {profile?.email}</p>
        <p><span className="text-ink-muted">Course:</span> {profile?.course}</p>
      </Card>
    </main>
  );
}

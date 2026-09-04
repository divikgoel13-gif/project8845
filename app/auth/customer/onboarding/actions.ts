"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// SRS §1.1: first-time onboarding collects name, email and course.
// Explicitly do NOT collect block/hostel in V1.
const OnboardingSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  course: z.string().trim().min(1).max(120),
});

export async function completeOnboarding(formData: FormData) {
  const profile = await requireProfile();

  const parsed = OnboardingSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    course: formData.get("course"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.errors.map((e) => e.message).join(", "));
  }

  const supabase = createServerSupabaseClient();
  // RLS policy `profiles_update_self` permits this — the caller updates
  // only their own row, and role/status are protected separately by the
  // trg_prevent_self_role_escalation trigger.
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", profile.id);

  if (error) {
    throw new Error(error.message);
  }

  redirect("/");
}

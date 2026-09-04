import { completeOnboarding } from "./actions";
import { Button } from "@/components/ui/button";

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-bold">Welcome to UNI8</h1>
      <p className="text-sm text-ink-soft">Just a few details before you order.</p>
      <form action={completeOnboarding} className="flex flex-col gap-3">
        <input
          name="name"
          required
          placeholder="Full name"
          className="rounded-brand border border-cream-300 bg-cream-50 px-4 py-2.5"
        />
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="rounded-brand border border-cream-300 bg-cream-50 px-4 py-2.5"
        />
        <input
          name="course"
          required
          placeholder="Course"
          className="rounded-brand border border-cream-300 bg-cream-50 px-4 py-2.5"
        />
        <Button type="submit">Continue</Button>
      </form>
    </main>
  );
}

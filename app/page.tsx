import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/**
 * Placeholder home/discovery page. Full customer discovery experience
 * (restaurant listing, search, product browsing) is a Phase 2 deliverable
 * (SRS Phase 2). This establishes the route, brand rendering, and that the
 * page is reachable unauthenticated for browsing per SRS §9 Discovery.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo variant="lockup" className="rounded-brand" />
      <h1 className="text-3xl font-bold">Your class ends. Your food is ready.</h1>
      <p className="max-w-md text-ink-soft">
        Order ahead from campus food joints, pick a pickup time, and skip the line.
      </p>
      <div className="flex gap-3">
        <a href="/restaurants">
          <Button>Browse restaurants</Button>
        </a>
        <a href="/auth/customer">
          <Button variant="ghost">Sign in</Button>
        </a>
      </div>
    </main>
  );
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Route-level RBAC gate (SRS §4, §17: "Server-side authorization checks
 * are mandatory"). This middleware does two jobs:
 *
 *  1. Refreshes the Supabase session cookie on every request (required by
 *     @supabase/ssr so server components see a valid session).
 *  2. Redirects unauthenticated or wrong-role users away from a role's
 *     route group BEFORE any page code runs.
 *
 * This is a COARSE, fast check (role only). It is not a substitute for the
 * FINE-GRAINED checks every Server Action/Route Handler must still perform
 * (e.g. "is this vendor admin scoped to THIS restaurant_id") — those live
 * in lib/auth/guards.ts and are enforced again at the RLS layer. Defense
 * in depth: middleware, action-level guard, and RLS are three independent
 * layers, and none of them trusts the others alone.
 */

const ROLE_ROUTE_PREFIXES: Record<string, string> = {
  "/vendor": "vendor_admin",
  "/staff": "staff",
  "/admin": "super_admin",
};

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const matchedPrefix = Object.keys(ROLE_ROUTE_PREFIXES).find((p) => path.startsWith(p));

  if (matchedPrefix) {
    if (!user) {
      const loginPath =
        matchedPrefix === "/admin"
          ? "/auth/admin"
          : matchedPrefix === "/vendor"
          ? "/auth/vendor"
          : "/auth/staff";
      return NextResponse.redirect(new URL(loginPath, request.url));
    }

    const requiredRole = ROLE_ROUTE_PREFIXES[matchedPrefix];
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();

    if (!profile || profile.status !== "active" || profile.role !== requiredRole) {
      // Super Admin is allowed to browse into /admin only — vendor/staff
      // areas stay scoped to their own role even for a Super Admin, who
      // uses the dedicated admin restaurant workspace instead (SRS §5).
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // Customer routes that require being signed in, but not a specific role
  // beyond "an authenticated customer" — discovery/menu browsing (SRS §9
  // Discovery) is deliberately NOT in this list, since browsing doesn't
  // require login, only ordering does (SRS §1.1).
  if (
    path.startsWith("/account") ||
    path.startsWith("/cart") ||
    path.startsWith("/checkout") ||
    path.startsWith("/orders")
  ) {
    if (!user) {
      return NextResponse.redirect(new URL("/auth/customer", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all routes except static assets and Next internals.
     */
    "/((?!_next/static|_next/image|favicon.ico|brand/).*)",
  ],
};

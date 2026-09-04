import { PasswordLoginForm } from "@/components/auth/password-login-form";
import { Logo } from "@/components/brand/logo";

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-6">
      <Logo />
      <h1 className="text-xl font-bold">Super Admin sign in</h1>
      <PasswordLoginForm expectedRole="super_admin" redirectTo="/admin/dashboard" />
    </main>
  );
}

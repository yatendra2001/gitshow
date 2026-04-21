import { redirect } from "next/navigation";
import { getSession } from "@/auth";
import { SignInButton } from "./signin-button";
import { Logo } from "@/components/logo";

/**
 * /signin is only useful when you're signed out. If a session cookie
 * is already live, bounce straight to the dashboard — stopping on a
 * page asking you to sign in again is always a bug.
 */
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await getSession();
  if (session?.user?.id) redirect("/app");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-12">
        <Logo href="/" size={28} />
      </div>

      <h1 className="mb-3 font-serif text-3xl leading-tight tracking-tight">
        Sign in to generate your portfolio
      </h1>
      <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
        We use your GitHub identity so you can read back private-repo
        analyses if you grant that scope. We never store source code —
        just commit metadata, PR descriptions, and review traces.
      </p>

      <SignInButton />
    </main>
  );
}

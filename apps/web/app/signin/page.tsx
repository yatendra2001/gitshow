import { signIn } from "@/auth";
import Link from "next/link";
import { Github, ArrowUpRight } from "lucide-react";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-12 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground font-mono text-xs font-bold text-background">
          g
        </div>
        <span className="text-sm font-bold tracking-tight">
          gitshow<span className="text-muted-foreground">.io</span>
        </span>
      </div>

      <h1 className="mb-3 font-serif text-3xl leading-tight tracking-tight">
        Sign in to generate your profile
      </h1>
      <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
        We use your GitHub identity so you can read back private-repo
        analyses if you grant that scope. We never store source code — just
        commit metadata, PR descriptions, and review traces.
      </p>

      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/dashboard" });
        }}
      >
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90"
        >
          <Github className="size-4" />
          Continue with GitHub
          <ArrowUpRight className="size-4" />
        </button>
      </form>

      <div className="mt-8 text-xs text-muted-foreground">
        <Link
          href="/s/demo"
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          Or see a demo profile first (no sign-in)
        </Link>
      </div>
    </main>
  );
}

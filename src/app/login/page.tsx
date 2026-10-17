import { Suspense } from "react";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex flex-1 flex-col justify-center gap-10 py-16">
      <header className="space-y-3">
        <h1 className="font-display text-5xl tracking-tight text-gold">{APP_NAME}</h1>
        <p className="font-display text-lg text-muted italic">{APP_TAGLINE}</p>
      </header>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

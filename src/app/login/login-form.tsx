"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(params.get("error") ? "error" : "idle");
  const [message, setMessage] = useState(params.get("error") ? "That link expired or was already used. Send a new one." : "");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const { error } = await createClient().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setStatus("sent");
      setMessage(`Check ${email} for your sign-in link.`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not send the link.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="glass space-y-4 p-5">
      <label htmlFor="email" className="block text-sm text-muted">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="h-12 w-full rounded-xl border border-border bg-black/30 px-4 text-base outline-none focus:border-gold"
        placeholder="you@tulane.edu"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="h-12 w-full rounded-xl bg-gold font-medium text-bg transition-opacity disabled:opacity-60"
      >
        {status === "sending" ? "Sending" : "Send magic link"}
      </button>
      {message && (
        <p role="status" className={status === "error" ? "text-sm text-athletics" : "text-sm text-muted"}>
          {message}
        </p>
      )}
    </form>
  );
}

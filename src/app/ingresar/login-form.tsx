"use client";

import { useActionState } from "react";
import { iniciarSesion, type LoginState } from "@/lib/actions/auth";

const inicial: LoginState = {};
const inputCls =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base outline-none focus:border-green-500 dark:border-zinc-700 dark:bg-zinc-950";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(iniciarSesion, inicial);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Contraseña
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputCls}
        />
      </label>

      {state.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-green-600 px-4 py-2.5 text-base font-medium text-white hover:bg-green-700 disabled:opacity-60"
      >
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}

"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  crearUsuario,
  cambiarRol,
  borrarUsuario,
  type UsuarioListado,
} from "@/lib/actions/usuarios";

const inputCls =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-green-500 dark:border-zinc-700 dark:bg-zinc-950";

export function EmpleadosCliente({
  usuarios,
  miId,
}: {
  usuarios: UsuarioListado[];
  miId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [abrirForm, setAbrirForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<"empleado" | "admin">("empleado");

  function crear(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await crearUsuario({ nombre, email, password, rol });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNombre("");
      setEmail("");
      setPassword("");
      setRol("empleado");
      setAbrirForm(false);
      router.refresh();
    });
  }

  function alternarRol(u: UsuarioListado) {
    setError(null);
    const nuevo = u.rol === "admin" ? "empleado" : "admin";
    startTransition(async () => {
      const res = await cambiarRol(u.id, nuevo);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function eliminar(u: UsuarioListado) {
    setError(null);
    if (!window.confirm(`¿Borrar a ${u.nombre || u.email}? No se puede deshacer.`)) {
      return;
    }
    startTransition(async () => {
      const res = await borrarUsuario(u.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-500">{usuarios.length} usuario(s)</span>
        <button
          onClick={() => {
            setAbrirForm((v) => !v);
            setError(null);
          }}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          {abrirForm ? "Cancelar" : "Nuevo empleado"}
        </button>
      </div>

      {abrirForm ? (
        <form
          onSubmit={crear}
          className="grid gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-2"
        >
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre"
            required
            className={inputCls}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="Email"
            required
            className={inputCls}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="text"
            placeholder="Contraseña (mín. 6)"
            required
            className={inputCls}
          />
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value as "empleado" | "admin")}
            className={inputCls}
          >
            <option value="empleado">Empleado</option>
            <option value="admin">Admin</option>
          </select>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              {pending ? "Creando…" : "Crear empleado"}
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-red-100 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => {
              const soyYo = u.id === miId;
              return (
                <tr
                  key={u.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  <td className="px-4 py-3">
                    {u.nombre || <span className="text-zinc-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.rol === "admin"
                          ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {u.rol}
                    </span>
                    {soyYo ? (
                      <span className="ml-2 text-xs text-zinc-400">(vos)</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {soyYo ? null : (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => alternarRol(u)}
                          disabled={pending}
                          className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        >
                          {u.rol === "admin" ? "Hacer empleado" : "Hacer admin"}
                        </button>
                        <button
                          onClick={() => eliminar(u)}
                          disabled={pending}
                          className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950"
                        >
                          Borrar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

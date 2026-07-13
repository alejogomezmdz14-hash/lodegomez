"use client";

import { useSyncExternalStore } from "react";

// El turno funciona como "caja": mañana / tarde. Se elige por dispositivo
// (localStorage) y se limpia al cerrar la caja, obligando a re-elegir.
export type Turno = "manana" | "tarde";

export const TURNOS: { valor: Turno; label: string }[] = [
  { valor: "manana", label: "Turno mañana" },
  { valor: "tarde", label: "Turno tarde" },
];

export const turnoLabel = (t: string | null | undefined) =>
  TURNOS.find((x) => x.valor === t)?.label ?? "—";

const KEY = "lodegomez.turno";
const EVENTO = "turno-cambio";

export function getTurno(): Turno | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(KEY);
  return v === "manana" || v === "tarde" ? v : null;
}

export function setTurno(t: Turno) {
  localStorage.setItem(KEY, t);
  window.dispatchEvent(new Event(EVENTO));
}

export function clearTurno() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENTO));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENTO, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENTO, cb);
    window.removeEventListener("storage", cb);
  };
}

// Hook reactivo (store externo = localStorage). `listo` es false en SSR/hidratación
// y true en cliente, para no mostrar el selector antes de leer el turno.
export function useTurno(): {
  turno: Turno | null;
  elegir: (t: Turno) => void;
  limpiar: () => void;
  listo: boolean;
} {
  const turno = useSyncExternalStore(subscribe, getTurno, () => null);
  const listo = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return { turno, elegir: setTurno, limpiar: clearTurno, listo };
}

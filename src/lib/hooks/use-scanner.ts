"use client";

import { useEffect, useRef } from "react";

// La pistola láser es un emulador de teclado: "tipea" el código muy rápido y
// cierra con Enter. Este hook escucha keydown en window (anda aunque el foco
// esté en otro lado) y detecta la ráfaga por TIMING. Se usa como red de
// seguridad: captura el scan aunque el foco se haya ido al buscador. El input
// de código visible maneja el caso normal (scan + tipeo manual).

const RESET_GAP_MS = 100; // gap que reinicia el buffer (nueva secuencia)
const SCAN_MAX_GAP_MS = 50; // gap promedio por debajo de esto = ráfaga de pistola
const SCAN_MIN_LEN = 3; // una ráfaga real tiene varios caracteres

type Opts = {
  enabled?: boolean;
  // Elemento cuyo foco hace que el hook NO intervenga (el input lo maneja solo).
  ignore?: () => Element | null | undefined;
};

export function useScanner(onScan: (code: string) => void, opts?: Opts) {
  const { enabled = true, ignore } = opts ?? {};
  const buffer = useRef("");
  const gaps = useRef<number[]>([]);
  const last = useRef(0);
  const onScanRef = useRef(onScan);
  const ignoreRef = useRef(ignore);
  useEffect(() => {
    onScanRef.current = onScan;
    ignoreRef.current = ignore;
  }, [onScan, ignore]);

  useEffect(() => {
    if (!enabled) return;

    function handle(e: KeyboardEvent) {
      // Si el foco está en el input de código, ese input maneja todo.
      const ignoreEl = ignoreRef.current?.();
      if (ignoreEl && document.activeElement === ignoreEl) return;

      const now = performance.now();
      const gap = now - last.current;
      last.current = now;

      if (e.key === "Enter") {
        const code = buffer.current;
        const avg = gaps.current.length
          ? gaps.current.reduce((a, b) => a + b, 0) / gaps.current.length
          : Infinity;
        buffer.current = "";
        gaps.current = [];
        const esScan = avg < SCAN_MAX_GAP_MS && code.length >= SCAN_MIN_LEN;
        if (esScan) {
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      if (e.key.length === 1) {
        if (gap > RESET_GAP_MS) {
          buffer.current = e.key;
          gaps.current = [];
        } else {
          buffer.current += e.key;
          gaps.current.push(gap);
        }
      }
    }

    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [enabled]);
}

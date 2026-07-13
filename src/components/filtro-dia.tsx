"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

// Selector de día que filtra por la query string ?dia=YYYY-MM-DD (server-side).
export function FiltroDia() {
  const router = useRouter();
  const params = useSearchParams();
  const path = usePathname();
  const dia = params.get("dia") ?? "";

  function set(v: string) {
    const p = new URLSearchParams(params.toString());
    if (v) p.set("dia", v);
    else p.delete("dia");
    const qs = p.toString();
    router.push(qs ? `${path}?${qs}` : path);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={dia}
        onChange={(e) => set(e.target.value)}
        className="h-10 rounded-lg border-2 border-border bg-background px-2 text-sm"
      />
      {dia ? (
        <Button variant="ghost" size="sm" onClick={() => set("")}>
          Ver todos
        </Button>
      ) : null}
    </div>
  );
}

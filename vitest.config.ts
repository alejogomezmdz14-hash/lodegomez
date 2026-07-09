import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // `server-only` (marcador de Next.js) no se resuelve bajo pnpm+vitest y su
      // index.js tira error fuera de un Server Component. Lo mapeamos a un módulo
      // vacío para poder testear módulos server-only (p.ej. afip/wsaa).
      "server-only": fileURLToPath(
        new URL("./test/stubs/server-only.ts", import.meta.url),
      ),
      // Path alias de tsconfig (`@/*` → `./src/*`) para que vitest resuelva los
      // imports absolutos del proyecto.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

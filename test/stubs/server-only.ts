// Stub vacío para los tests. `server-only` es un marcador de Next.js: en la app
// impide importar el módulo desde el cliente, pero fuera de Next su index.js tira
// error (y con pnpm ni siquiera está en el node_modules raíz). vitest lo aliasea
// acá para poder importar módulos `server-only` en unit tests.
export {};

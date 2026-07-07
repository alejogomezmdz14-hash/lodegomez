// ============================================================================
// Migración Fase 1: STOCK.DBF -> seed SQL para public.productos
//
// Uso:  node scripts/migrate-dbf.mjs "C:\\Users\\alejo\\Downloads\\STOCK.DBF"
//
// NO toca la base de datos. Genera dos archivos para que los revises:
//   - supabase/seed/0001_productos_seed.sql   (INSERTs)
//   - docs/migracion-fase1-reporte.md         (QA: qué se decidió y anomalías)
//
// Reglas (editá los mapas de abajo si querés otro criterio):
//   - Rubros: se normalizan variantes (LIMPIEZA, SNACKS, CARAMELOS...).
//   - IVA: verdura/pan/carne y huevos = 10.5%; el resto 21% (editable por producto).
//   - Stock mínimo: por rotación del rubro; pesables sin mínimo (a mano).
//   - Margen: se calcula (venta-costo)/costo*100; se ignora GCIA (poco confiable).
//   - Pesables: fiambre/verdura/carne genéricos + rubro pesable con stock fraccionario.
//   - modificado_en: se lee del campo COLOR del DBF (ahí guardó la fecha el Easy POS).
// ============================================================================
import fs from "node:fs";
import path from "node:path";

const dbfPath = process.argv[2] || "C:\\Users\\alejo\\Downloads\\STOCK.DBF";
const repoRoot = process.cwd();

// --- Parser DBF (dBASE III) ---
const buf = fs.readFileSync(dbfPath);
const numRecords = buf.readUInt32LE(4);
const headerLen = buf.readUInt16LE(8);
const recordLen = buf.readUInt16LE(10);
const fields = [];
let off = 32;
while (off < headerLen && buf[off] !== 0x0d) {
  let name = "";
  for (let i = 0; i < 11; i++) { const c = buf[off + i]; if (c === 0) break; name += String.fromCharCode(c); }
  fields.push({ name, length: buf[off + 16] });
  off += 32;
}
const dec = (b) => Buffer.from(b).toString("latin1");
function readRec(idx) {
  let p = headerLen + idx * recordLen + 1;
  const r = {};
  for (const f of fields) { r[f.name] = dec(buf.slice(p, p + f.length)).trim(); p += f.length; }
  return r;
}

// --- Mapas de normalización ---
const RUBRO_MAP = {
  "ART. LIMPIEZA": "LIMPIEZA",
  "ART.LIMPIEZ": "LIMPIEZA",
  "SNAKS": "SNACKS",
  "CARAMELOS SUELTOS": "CARAMELOS",
};
const normRubro = (r) => {
  const u = (r || "").trim().toUpperCase();
  if (u === "") return "SIN RUBRO";
  return RUBRO_MAP[u] || u;
};

const EGG_CODES = new Set(["0", "00", "000", "0000"]);
const IVA_105_RUBROS = new Set(["VERDURAS Y FRUTAS", "PANADERIA", "CARNES"]);
const ivaFor = (rubro, codigo) =>
  EGG_CODES.has(codigo) || IVA_105_RUBROS.has(rubro) ? 10.5 : 21.0;

const ROT_ALTA = new Set(["CIGARRILLOS","TABACO","BEBIDAS","GOLOSINAS","GALLETITAS","LACTEOS","SNACKS","ALFAJORES","CHOCOLATES","CARAMELOS","CHICLES","CHUPETINES","PASTILLAS","BOMBONES","BARRITAS","ENERGIZANTES","HELADOS"]);
const ROT_MEDIA = new Set(["ALMACEN","FIAMBRERIA","PERFUMERIA","LIMPIEZA","LIBRERIA","FARMACIA","MEDICAMENTOS","CAFE","PANADERIA"]);
const ROT_BAJA = new Set(["JUGUETES","ELECTRONICA","VARIOS","GENERAL","SIN RUBRO","PRESERVATIVOS","RECARGA VIRTUAL"]);
function stockMin(rubro, esPesable) {
  if (esPesable) return null;
  if (ROT_ALTA.has(rubro)) return 6;
  if (ROT_MEDIA.has(rubro)) return 3;
  if (ROT_BAJA.has(rubro)) return 2;
  return 3; // default rotación media
}

const PESABLE_GENERIC = new Set(["99", "999", "333"]);
const PESABLE_RUBROS = new Set(["FIAMBRERIA", "VERDURAS Y FRUTAS", "CARNES"]);
function esPesable(rubro, codigo, stock) {
  if (PESABLE_GENERIC.has(codigo)) return true;
  if (PESABLE_RUBROS.has(rubro) && Math.abs(stock - Math.round(stock)) > 1e-6) return true;
  return false;
}

const num = (s) => { const v = parseFloat(s); return isNaN(v) ? 0 : v; };
function parseColorDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec((s || "").trim());
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = "20" + y;
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(iso + "T00:00:00Z");
  return isNaN(dt.getTime()) ? null : iso;
}
const sql = (v) => v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`;
const sqlNum = (v) => v === null || v === undefined ? "null" : String(v);
const sqlBool = (v) => (v ? "true" : "false");

// --- Transformar ---
const out = [];
const report = { total: 0, pesables: 0, iva105: 0, negativos: 0, sinCosto: 0, sinPrecio: 0, sinDescripcion: 0, rubrosNorm: {}, negAltaRotacion: [], pesablesList: [] };

for (let i = 0; i < numRecords; i++) {
  const r = readRec(i);
  const codigo = r.CODIGO.trim();
  if (!codigo) continue; // saltea el registro sin código
  const rubroOrig = r.RUBRO.trim();
  const rubro = normRubro(rubroOrig);
  if (rubro !== rubroOrig.toUpperCase() && rubroOrig !== "") report.rubrosNorm[rubroOrig] = rubro;

  const costo = num(r.PRECIOC);
  const venta = num(r.PRECIOVP);
  const stock = num(r.STEXISTEN);
  const pesable = esPesable(rubro, codigo, stock);
  const margen = costo > 0 && venta > 0 ? Math.round(((venta - costo) / costo) * 10000) / 100 : null;
  const iva = ivaFor(rubro, codigo);
  const necesitaInv = stock < 0;
  const desc = r.DETALLE.trim() || null;

  report.total++;
  if (pesable) { report.pesables++; report.pesablesList.push(`${codigo} — ${desc || ""} (${rubro})`); }
  if (iva === 10.5) report.iva105++;
  if (stock < 0) report.negativos++;
  if (costo <= 0) report.sinCosto++;
  if (venta <= 0) report.sinPrecio++;
  if (!desc) report.sinDescripcion++;
  if (stock < 0 && ROT_ALTA.has(rubro)) report.negAltaRotacion.push(`${codigo} — ${desc || ""} (${rubro}, stock ${stock})`);

  out.push(
    "  (" +
      [
        sql(codigo),
        sql(desc),
        sql(rubro),
        sql(rubroOrig || null),
        sqlNum(costo > 0 ? costo.toFixed(2) : null),
        sqlNum(venta > 0 ? venta.toFixed(2) : null),
        sqlNum(margen),
        sqlNum(iva),
        sqlNum(stock),
        sqlNum(stockMin(rubro, pesable)),
        sqlBool(pesable),
        sqlNum(pesable ? venta.toFixed(2) : null),
        sqlBool(necesitaInv),
        sql(parseColorDate(r.COLOR)),
      ].join(", ") +
      ")"
  );
}

// --- Escribir seed SQL ---
const cols = "codigo, descripcion, rubro, rubro_original, precio_costo, precio_venta, margen_pct, iva_pct, stock, stock_minimo, es_pesable, precio_por_kg, necesita_inventario, modificado_en";
const chunks = [];
const BATCH = 500;
for (let i = 0; i < out.length; i += BATCH) {
  chunks.push(
    `insert into public.productos (${cols}) values\n` +
      out.slice(i, i + BATCH).join(",\n") +
      "\non conflict (codigo) do nothing;"
  );
}
const seedHeader = `-- Seed de productos (Fase 1) generado desde STOCK.DBF. Revisar antes de aplicar.\n-- Total: ${report.total} productos.\n\n`;
const seedDir = path.join(repoRoot, "supabase", "seed");
fs.mkdirSync(seedDir, { recursive: true });
fs.writeFileSync(path.join(seedDir, "0001_productos_seed.sql"), seedHeader + chunks.join("\n\n") + "\n");

// --- Escribir reporte ---
const rep = [];
rep.push(`# Migración Fase 1 — reporte de QA\n`);
rep.push(`Generado desde \`STOCK.DBF\`. **Revisar antes de aplicar a Supabase.**\n`);
rep.push(`## Totales`);
rep.push(`- Productos migrados: **${report.total}**`);
rep.push(`- Marcados **pesables** (por kg): **${report.pesables}**`);
rep.push(`- Con **IVA 10,5%**: **${report.iva105}** (verdura/pan/carne/huevos) — el resto 21%`);
rep.push(`- Con **stock negativo** (marcados \`necesita_inventario\`): **${report.negativos}**`);
rep.push(`- Sin costo: ${report.sinCosto} · Sin precio de venta: ${report.sinPrecio} · Sin descripción: ${report.sinDescripcion}\n`);
rep.push(`## Rubros normalizados (original → nuevo)`);
const rn = Object.entries(report.rubrosNorm);
if (rn.length) for (const [o, n] of rn) rep.push(`- \`${o}\` → \`${n}\``); else rep.push(`- (ninguno)`);
rep.push(`\n## Productos marcados pesables (revisá que estén todos y ninguno de más)`);
for (const p of report.pesablesList) rep.push(`- ${p}`);
rep.push(`\n## Stock negativo en alta rotación (prioridad para inventario físico)`);
if (report.negAltaRotacion.length) for (const p of report.negAltaRotacion.slice(0, 100)) rep.push(`- ${p}`);
else rep.push(`- (ninguno)`);
if (report.negAltaRotacion.length > 100) rep.push(`- ...y ${report.negAltaRotacion.length - 100} más`);
const docsDir = path.join(repoRoot, "docs");
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(path.join(docsDir, "migracion-fase1-reporte.md"), rep.join("\n") + "\n");

console.log(`OK. Productos: ${report.total} | pesables: ${report.pesables} | iva105: ${report.iva105} | negativos: ${report.negativos}`);
console.log(`Seed:    supabase/seed/0001_productos_seed.sql`);
console.log(`Reporte: docs/migracion-fase1-reporte.md`);

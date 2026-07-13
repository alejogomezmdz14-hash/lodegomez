// Rango [desde, hasta) de un día de Argentina (UTC−3, sin horario de verano)
// a partir de un "YYYY-MM-DD". Devuelve {} si no hay día válido (= sin filtro).
export function rangoDia(dia?: string): { p_desde?: string; p_hasta?: string } {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return {};
  const desde = new Date(`${dia}T00:00:00-03:00`);
  if (Number.isNaN(desde.getTime())) return {};
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);
  return { p_desde: desde.toISOString(), p_hasta: hasta.toISOString() };
}

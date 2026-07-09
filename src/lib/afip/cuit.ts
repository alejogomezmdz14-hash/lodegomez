// Valida CUIT/CUIL argentino (11 dígitos, dígito verificador mód 11).
export function validarCuit(cuit: string): boolean {
  const s = (cuit ?? "").replace(/\D/g, "");
  if (s.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const nums = s.split("").map(Number);
  const suma = pesos.reduce((acc, p, i) => acc + p * nums[i], 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === nums[10];
}

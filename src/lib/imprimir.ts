// Imprime el ticket, pero espera a que el logo esté cargado. Si no, el navegador
// dispara la impresión antes de que la imagen esté lista y el ticket sale sin logo.
export function imprimirTicket(): void {
  if (typeof window === "undefined") return;
  let hecho = false;
  const go = () => {
    if (hecho) return;
    hecho = true;
    window.print();
  };
  const img = new window.Image();
  img.onload = go;
  img.onerror = go; // imprimí igual aunque el logo falle
  img.src = "/brand/logo.png";
  if (img.complete) go();
  window.setTimeout(go, 2000); // red de seguridad
}

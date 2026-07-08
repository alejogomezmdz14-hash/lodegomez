import type { MetadataRoute } from "next";

// PWA instalable (corre en la PC del mostrador, tablet y celu). El service
// worker/offline se difiere; esto solo habilita "instalar la app".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lo De Gómez",
    short_name: "Lo De Gómez",
    description: "Sistema de gestión del minimercado: cobro, stock y caja.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "es-AR",
    icons: [
      {
        src: "/brand/logo.png",
        sizes: "1037x1517",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}

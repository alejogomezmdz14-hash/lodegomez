import Image from "next/image";
import { cn } from "@/lib/utils";

// Logo completo (wordmark + carrito + "Super Completo"), B&N vintage. 1037×1517.
// Pasar el tamaño por className, p. ej. <Marca className="h-12 w-auto" />.
export function Marca({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/logo.png"
      alt="Lo De Gómez"
      width={1037}
      height={1517}
      priority={priority}
      className={cn("object-contain", className)}
    />
  );
}

// Wordmark tipográfico, para lockups horizontales donde el logo vertical no entra.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold tracking-tight", className)}>
      Lo De Gómez
    </span>
  );
}

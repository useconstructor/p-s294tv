export type Category = { id: string; nombre: string };
export type Product = {
  id: string;
  nombre: string;
  categoria_id: string;
  stock: number;
  precio_centimos: number;
  version: number;
  created_at: string;
  updated_at: string;
};
export type Draft = {
  nombre: string;
  categoria_id: string;
  stock: string;
  precio: string;
};
export function priceCents(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return NaN;
  const decimal = String(value).replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(decimal)) return NaN;
  const [whole, fraction = ""] = decimal.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : NaN;
}
export function validate(d: Draft) {
  const errors: Record<string, string> = {};
  if (
    typeof d.nombre !== "string" ||
    !d.nombre.trim() ||
    d.nombre.trim().length > 120
  )
    errors.nombre = "Introduce un nombre de 1 a 120 caracteres.";
  if (!d.categoria_id) errors.categoria_id = "Selecciona una categoría.";
  if ((typeof d.stock !== "string" && typeof d.stock !== "number") || !/^\d+$/.test(String(d.stock)))
    errors.stock = "Usa un entero de 0 a 1.000.000.";
  else if (!Number.isSafeInteger(Number(d.stock)) || Number(d.stock) > 1_000_000)
    errors.stock = "El stock máximo es 1.000.000.";
  const cents = priceCents(d.precio);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) {
    const decimal = typeof d.precio === "string" || typeof d.precio === "number"
      ? String(d.precio).replace(",", ".")
      : "";
    errors.precio = /^-/.test(decimal)
      ? "Introduce un precio igual o mayor que cero."
      : /^\d+\.\d{3,}$/.test(decimal)
        ? "Usa un máximo de dos decimales."
        : /^\d+(\.\d{1,2})?$/.test(decimal)
          ? "El precio máximo es 1.000.000,00 €."
          : "Introduce un precio decimal, por ejemplo 12,50.";
  }
  return errors;
}
export const euro = (c: number | string) => {
  const cents = BigInt(c);
  return `${new Intl.NumberFormat("es-ES").format(cents / BigInt(100))},${String(cents % BigInt(100)).padStart(2, "0")}\u00a0€`;
};
export const number = (n: number | string) =>
  new Intl.NumberFormat("es-ES").format(BigInt(n));
export function draftOf(p: Product): Draft {
  return {
    nombre: p.nombre,
    categoria_id: p.categoria_id,
    stock: String(p.stock),
    precio: `${BigInt(p.precio_centimos) / BigInt(100)},${String(BigInt(p.precio_centimos) % BigInt(100)).padStart(2, "0")}`,
  };
}

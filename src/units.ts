export const units = {
  /** Watts -> cavalo-vapor (metric horsepower). */
  toCv: (watts: number) => watts / 735.49875,
  /** Watts -> mechanical horsepower. */
  toHp: (watts: number) => watts / 745.699872,
};

const formatters = new Map<number, Intl.NumberFormat>();

/** Locale-aware number formatting with a fixed number of decimals. */
export function fmt(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "–";
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(decimals, f);
  }
  return f.format(value);
}

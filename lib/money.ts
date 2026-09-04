/**
 * All money is stored as integer paise (see docs/ARCHITECTURE.md). These
 * helpers are the ONLY place paise↔rupee conversion/formatting should
 * happen — never do `paise / 100` inline in a component, so a future
 * change (e.g. locale support) has one place to change.
 */
export function paiseToRupeesDisplay(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

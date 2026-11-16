/** Pack-size math for the unit-price column. Pure functions, no DOM. */

export const UNITS = [
  { id: "g", label: "g", family: "weight", toBase: (n) => n },
  { id: "kg", label: "kg", family: "weight", toBase: (n) => n * 1000 },
  { id: "ml", label: "ml", family: "volume", toBase: (n) => n },
  { id: "L", label: "L", family: "volume", toBase: (n) => n * 1000 },
  { id: "cm", label: "cm", family: "length", toBase: (n) => n },
  { id: "m", label: "m", family: "length", toBase: (n) => n * 100 },
  { id: "pc", label: "pc", family: "count", toBase: (n) => n },
];

/** Basis amounts are in the family base unit: g, ml, cm, or pieces. */
export const BASES = {
  weight: [
    { id: "100g", label: "per 100 g", short: "100 g", amount: 100 },
    { id: "1kg", label: "per 1 kg", short: "1 kg", amount: 1000 },
  ],
  volume: [
    { id: "100ml", label: "per 100 ml", short: "100 ml", amount: 100 },
    { id: "1L", label: "per 1 L", short: "1 L", amount: 1000 },
  ],
  length: [
    { id: "1m", label: "per 1 m", short: "1 m", amount: 100 },
    { id: "10cm", label: "per 10 cm", short: "10 cm", amount: 10 },
  ],
  count: [{ id: "1pc", label: "per piece", short: "1 pc", amount: 1 }],
};

const UNIT_BY_ID = Object.fromEntries(UNITS.map((unit) => [unit.id, unit]));

export function unitById(id) {
  return UNIT_BY_ID[id] || null;
}

export function basisFor(family, settings) {
  const options = BASES[family] || [];
  const chosen = settings?.[`${family}Basis`];
  return options.find((item) => item.id === chosen) || options[0] || null;
}

/**
 * Price scaled to the basis selected in settings.
 * 890 for 350 g, basis 100 g → 254.2857…
 * Returns null when the size is missing or not a positive number.
 */
export function unitPrice(price, quantity, unitId, settings) {
  const unit = unitById(unitId);
  const qty = Number(quantity);
  const cost = Number(price);
  if (!unit || !(qty > 0) || !Number.isFinite(cost) || cost < 0) return null;
  const baseQty = unit.toBase(qty);
  if (!(baseQty > 0)) return null;
  const basis = basisFor(unit.family, settings);
  if (!basis) return null;
  return {
    value: (cost / baseQty) * basis.amount,
    short: basis.short,
    label: basis.label,
    family: unit.family,
  };
}

export function basisSummary(settings) {
  return ["weight", "volume", "length", "count"]
    .map((family) => basisFor(family, settings)?.label)
    .filter(Boolean)
    .join(" · ");
}

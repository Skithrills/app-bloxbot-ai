const costFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

export function formatModelCost(cost: number): string {
  return cost < 0.0001 ? "<$0.0001" : costFormat.format(cost);
}

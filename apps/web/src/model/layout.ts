export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Places parties evenly on a circle, the first at the top, going clockwise. */
export function circleLayout(parties: readonly string[], center: Point, radius: number): Map<string, Point> {
  return new Map(
    parties.map((party, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(parties.length, 1);
      return [party, { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }];
    }),
  );
}

/**
 * A curved path from `from` to `to`, bowed to the left of travel so that
 * debts running both ways between two parties do not overlap. Stops `inset`
 * short of each end so arrowheads sit outside the party markers.
 */
export function curvedEdge(from: Point, to: Point, bow: number, inset: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const start = { x: from.x + ux * inset, y: from.y + uy * inset };
  const end = { x: to.x - ux * inset, y: to.y - uy * inset };
  const control = { x: (start.x + end.x) / 2 + uy * bow, y: (start.y + end.y) / 2 - ux * bow };
  return `M${round(start.x)},${round(start.y)} Q${round(control.x)},${round(control.y)} ${round(end.x)},${round(end.y)}`;
}

/** Stroke width for an amount, by area so large debts do not swamp the picture. */
export function strokeWidth(amount: bigint, largest: bigint, min = 1.5, max = 12): number {
  if (largest <= 0n || amount <= 0n) return 0;
  const ratio = Number((amount * 1_000_000n) / largest) / 1_000_000;
  return min + (max - min) * Math.sqrt(ratio);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

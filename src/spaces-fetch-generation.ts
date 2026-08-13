/**
 * Monotonic gate so overlapping `/api/spaces` fetches cannot apply out of order.
 * Call `begin()` when starting a fetch (or when applying a mutation that should
 * invalidate in-flight GETs). Only apply a response when `isCurrent(token)`.
 */
export function createSpacesFetchGate() {
  let generation = 0;
  return {
    begin(): number {
      generation += 1;
      return generation;
    },
    isCurrent(token: number): boolean {
      return token === generation;
    },
    get current(): number {
      return generation;
    },
  };
}

export type SpacesFetchGate = ReturnType<typeof createSpacesFetchGate>;

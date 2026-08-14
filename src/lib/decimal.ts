import Decimal from "decimal.js";

Decimal.set({ precision: 40 });

export { Decimal };
export const BASE_ROUNDING = Decimal.ROUND_HALF_UP;

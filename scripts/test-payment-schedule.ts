import assert from "node:assert/strict";
import { computePaymentSchedule } from "../shared/calculations";

for (const payable of [17296.44, 844, 1500000, 1500000.49, 3000000, 3000000.51]) {
  const schedule = computePaymentSchedule(payable);
  assert.equal(
    schedule.total,
    Math.round(payable),
    `payment schedule must reconcile for ${payable}`,
  );
  assert.equal(
    schedule.tokenAdvance
      + schedule.preSignoff
      + schedule.designSignoff
      + schedule.materialDelivery
      + schedule.retention,
    schedule.total,
  );
  for (const installment of [
    schedule.tokenAdvance,
    schedule.preSignoff,
    schedule.designSignoff,
    schedule.materialDelivery,
    schedule.retention,
  ]) {
    assert.ok(installment >= 0, `installments must be nonnegative for ${payable}`);
  }
}

console.log("PASS payment schedules reconcile to displayed final payable");
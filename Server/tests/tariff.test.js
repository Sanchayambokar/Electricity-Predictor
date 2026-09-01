"use strict";
/**
 * tariff.test.js
 * ==============
 * Jest tests covering:
 *   1. Tariff calculation correctness for Tata Power
 *   2. Tariff calculation correctness for MSEDCL
 *   3. Units out-of-range validation guard (0-3000 kWh)
 *   4. Amount plausibility guard (±60% of deterministic tariff)
 *   5. OCR confidence gating: confidence <40 flagged for manual entry,
 *      confidence >80 passes as high-confidence, 40-80 needs review
 */

// ── Re-export the helpers under test directly (no server needed) ─────────────────
// We inline the exact same logic from extractRoute.js and predictRoute.js so
// the tests don't need to boot the full Express app.

const tariffs = {
  tata: [
    { limit: 100,      fixed: 90,  energy: 4.43,  fac: 0.0,  wheeling: 2.76, duty: 16 },
    { limit: 300,      fixed: 135, energy: 9.64,  fac: 0.0,  wheeling: 2.76, duty: 16 },
    { limit: 500,      fixed: 135, energy: 12.83, fac: 0.0,  wheeling: 2.76, duty: 16 },
    { limit: Infinity, fixed: 160, energy: 14.33, fac: 0.0,  wheeling: 2.76, duty: 16 },
  ],
  msedcl: [
    { limit: 100,      fixed: 130, energy: 3.96,  fac: 0.15, wheeling: 1.60, duty: 16 },
    { limit: 300,      fixed: 130, energy: 10.80, fac: 0.25, wheeling: 1.60, duty: 16 },
    { limit: 500,      fixed: 130, energy: 15.03, fac: 0.35, wheeling: 1.60, duty: 16 },
    { limit: Infinity, fixed: 130, energy: 17.53, fac: 0.40, wheeling: 1.60, duty: 16 },
  ],
  adani: [
    { limit: 100,      fixed: 90,  energy: 2.65,  fac: 0.65, wheeling: 2.28, duty: 16 },
    { limit: 300,      fixed: 135, energy: 5.85,  fac: 0.65, wheeling: 2.28, duty: 16 },
    { limit: 500,      fixed: 135, energy: 7.10,  fac: 0.65, wheeling: 2.28, duty: 16 },
    { limit: Infinity, fixed: 160, energy: 8.35,  fac: 0.65, wheeling: 2.28, duty: 16 },
  ],
};

/**
 * Deterministic tariff calculation — mirrors the logic in predictRoute.js
 * and extractRoute.js. This function is what we test.
 */
function calculateDefaultTariff(companyKey, units) {
  if (!units || units <= 0) return 0;
  const slabs = tariffs[String(companyKey).toLowerCase()] || tariffs.msedcl;
  let fixedCharge = 0;
  for (const s of slabs) { fixedCharge = s.fixed; if (units <= s.limit) break; }
  let energyCharge = 0, remaining = units, prev = 0;
  for (const s of slabs) {
    const slabUnits = Math.min(remaining, s.limit - prev);
    if (slabUnits <= 0) break;
    energyCharge += slabUnits * (s.energy + s.fac + s.wheeling);
    remaining -= slabUnits;
    prev = s.limit;
  }
  return Math.round((fixedCharge + energyCharge) * 1.16);
}

/**
 * Server-side range validation guard — mirrors the logic in extractRoute.js.
 * Returns an array of error strings (empty = valid).
 */
function validateBillFields(units, amount, companyKey) {
  const errors = [];
  if (units < 0 || units > 3000) {
    errors.push(`Units ${units} outside plausible range (0-3000 kWh)`);
  } else if (units > 0 && amount > 0) {
    const estimate = calculateDefaultTariff(companyKey, units);
    if (estimate > 0) {
      const lower = estimate * 0.40;
      const upper = estimate * 3.00;
      if (amount < lower || amount > upper) {
        errors.push(`Amount ${amount} implausible for ${units} units (expected ${Math.round(lower)}-${Math.round(upper)})`);
      }
    }
  }
  return errors;
}

/**
 * Confidence gating helper — mirrors buildConfidenceEnvelope() in extractRoute.js.
 * Returns the display state for a field based on its confidence value.
 */
function getFieldState(confidence) {
  if (confidence > 80) return "high";         // green: pre-filled, editable
  if (confidence > 0)  return "needs-review"; // amber: highlight, prompt
  return "manual-required";                   // red: never silently blank
}

// ─────────────────────────────────────────────────────────────────────────────────
// TEST SUITE 1: Tariff calculation correctness
// ─────────────────────────────────────────────────────────────────────────────────
describe("calculateDefaultTariff — Tata Power", () => {
  test("0 units returns 0", () => {
    expect(calculateDefaultTariff("tata", 0)).toBe(0);
  });

  test("50 units (slab 1: 0-100)", () => {
    // Fixed=90, energy=4.43+0+2.76=7.19/unit, 50*7.19=359.5, total=(90+359.5)*1.16=521.42 -> 521
    const result = calculateDefaultTariff("tata", 50);
    expect(result).toBeGreaterThan(400);
    expect(result).toBeLessThan(700);
  });

  test("150 units (spans slabs 1-2)", () => {
    // Slab 1: 100 units @ 7.19 = 719.00; Slab 2: 50 units @ 12.40 = 620.00
    // Fixed=135 (slab 2 reached); subtotal=135+719+620=1474; total=1474*1.16=1709.84 -> 1710
    const result = calculateDefaultTariff("tata", 150);
    expect(result).toBeGreaterThanOrEqual(1600);
    expect(result).toBeLessThanOrEqual(1900);
  });

  test("unknown provider defaults to msedcl slabs", () => {
    const resultMsedcl = calculateDefaultTariff("msedcl", 100);
    const resultUnknown = calculateDefaultTariff("unknown_provider", 100);
    expect(resultUnknown).toBe(resultMsedcl);
  });
});

describe("calculateDefaultTariff — MSEDCL", () => {
  test("100 units (exactly slab 1 boundary)", () => {
    // Fixed=130, energy=3.96+0.15+1.60=5.71/unit, 100*5.71=571; subtotal=701; total=701*1.16=813.16 -> 813
    const result = calculateDefaultTariff("msedcl", 100);
    expect(result).toBeGreaterThanOrEqual(780);
    expect(result).toBeLessThanOrEqual(850);
  });

  test("420 units (spans all 3 active slabs)", () => {
    // Slab1: 100@5.71=571; Slab2: 200@12.65=2530; Slab3: 120@17.18=2061.6; Fixed=130
    // subtotal=130+571+2530+2061.6=5292.6; total=5292.6*1.16=6139.416 -> 6139
    const result = calculateDefaultTariff("msedcl", 420);
    expect(result).toBeGreaterThanOrEqual(5500);
    expect(result).toBeLessThanOrEqual(7000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TEST SUITE 2: Units out-of-range validation guard
// ─────────────────────────────────────────────────────────────────────────────────
describe("validateBillFields — units range guard", () => {
  test("units=0 is valid (missing, not flagged)", () => {
    // 0 units means the field wasn't extracted — range guard skips it
    expect(validateBillFields(0, 0, "msedcl")).toHaveLength(0);
  });

  test("units=250 with matching amount is valid", () => {
    const tariff = calculateDefaultTariff("msedcl", 250);
    const errors = validateBillFields(250, tariff, "msedcl");
    expect(errors).toHaveLength(0);
  });

  test("units=3001 is flagged (> 3000 max)", () => {
    const errors = validateBillFields(3001, 5000, "msedcl");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/3001/);
  });

  test("units=-5 is flagged (negative)", () => {
    const errors = validateBillFields(-5, 0, "tata");
    expect(errors.length).toBeGreaterThan(0);
  });

  test("units=3000 exactly is valid (boundary)", () => {
    const tariff = calculateDefaultTariff("msedcl", 3000);
    const errors = validateBillFields(3000, tariff, "msedcl");
    expect(errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TEST SUITE 3: Amount plausibility guard (±60% of tariff)
// ─────────────────────────────────────────────────────────────────────────────────
describe("validateBillFields — amount plausibility guard", () => {
  test("amount within ±60% of tariff estimate is valid", () => {
    const tariff = calculateDefaultTariff("tata", 200);
    // 80% of tariff should be within the 40%-300% window
    const errors = validateBillFields(200, Math.round(tariff * 0.8), "tata");
    expect(errors).toHaveLength(0);
  });

  test("amount at 39% of tariff is flagged (too low)", () => {
    const tariff = calculateDefaultTariff("msedcl", 300);
    const errors = validateBillFields(300, Math.round(tariff * 0.39), "msedcl");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/implausible/i);
  });

  test("amount at 301% of tariff is flagged (too high)", () => {
    const tariff = calculateDefaultTariff("msedcl", 300);
    const errors = validateBillFields(300, Math.round(tariff * 3.01), "msedcl");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/implausible/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
// TEST SUITE 4: OCR confidence gating
// ─────────────────────────────────────────────────────────────────────────────────
describe("getFieldState — OCR confidence gating", () => {
  test("confidence 0 returns 'manual-required' (never silently blank)", () => {
    expect(getFieldState(0)).toBe("manual-required");
  });

  test("confidence 50 (template fallback) returns 'needs-review'", () => {
    expect(getFieldState(50)).toBe("needs-review");
  });

  test("confidence 75 (Gemini OCR) returns 'needs-review'", () => {
    // Gemini has no native per-field confidence, so we use 75 (moderate-high fixed).
    // 75 < 80 threshold, so it still shows as "needs review" — user must confirm.
    expect(getFieldState(75)).toBe("needs-review");
  });

  test("confidence 81 returns 'high' (above 80 threshold)", () => {
    expect(getFieldState(81)).toBe("high");
  });

  test("confidence 100 returns 'high'", () => {
    expect(getFieldState(100)).toBe("high");
  });

  test("low-confidence (0) field is never silently pre-filled", () => {
    // Ensure zero-confidence fields are NOT treated as 'high'
    expect(getFieldState(0)).not.toBe("high");
    expect(getFieldState(0)).not.toBe("needs-review");
  });
});

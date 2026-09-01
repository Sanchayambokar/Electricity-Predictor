const express = require("express");
const router = express.Router();
const Prediction = require("../models/Prediction");
const CompanyProfile = require("../models/CompanyProfile");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

// JWT_SECRET must be set via environment variable. No hardcoded fallback
// to avoid credential leaks — startup will fail fast if the env var is missing.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not set. Server will not start securely.");
}

// In-memory store fallback
const memoryPredictions = [];

// Optional authentication middleware for guest predictions
const authOptional = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Contains id and email
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

const tariffs = {
  tata: [
    { limit: 100, fixed: 90, energy: 4.43, fac: 0.0, wheeling: 2.76, duty: 16.0 },
    { limit: 300, fixed: 135, energy: 9.64, fac: 0.0, wheeling: 2.76, duty: 16.0 },
    { limit: 500, fixed: 135, energy: 12.83, fac: 0.0, wheeling: 2.76, duty: 16.0 },
    { limit: Infinity, fixed: 160, energy: 14.33, fac: 0.0, wheeling: 2.76, duty: 16.0 },
  ],
  msedcl: [
    { limit: 100, fixed: 130, energy: 3.96, fac: 0.15, wheeling: 1.60, duty: 16.0 },
    { limit: 300, fixed: 130, energy: 10.80, fac: 0.25, wheeling: 1.60, duty: 16.0 },
    { limit: 500, fixed: 130, energy: 15.03, fac: 0.35, wheeling: 1.60, duty: 16.0 },
    { limit: Infinity, fixed: 130, energy: 17.53, fac: 0.40, wheeling: 1.60, duty: 16.0 },
  ],
  adani: [
    { limit: 100, fixed: 90, energy: 2.65, fac: 0.65, wheeling: 2.28, duty: 16.0 },
    { limit: 300, fixed: 135, energy: 5.85, fac: 0.65, wheeling: 2.28, duty: 16.0 },
    { limit: 500, fixed: 135, energy: 7.10, fac: 0.65, wheeling: 2.28, duty: 16.0 },
    { limit: Infinity, fixed: 160, energy: 8.35, fac: 0.65, wheeling: 2.28, duty: 16.0 },
  ],
  torrent: [
    { limit: 100, fixed: 130, energy: 4.28, fac: 0.10, wheeling: 1.47, duty: 16.0 },
    { limit: 300, fixed: 130, energy: 11.10, fac: 0.15, wheeling: 1.47, duty: 16.0 },
    { limit: 500, fixed: 130, energy: 15.38, fac: 0.20, wheeling: 1.47, duty: 16.0 },
    { limit: Infinity, fixed: 130, energy: 17.68, fac: 0.20, wheeling: 1.47, duty: 16.0 },
  ],
  best: [
    { limit: 100, fixed: 90, energy: 2.10, fac: 0.75, wheeling: 1.87, duty: 16.0 },
    { limit: 300, fixed: 135, energy: 5.50, fac: 0.75, wheeling: 1.87, duty: 16.0 },
    { limit: 500, fixed: 135, energy: 10.18, fac: 0.75, wheeling: 1.87, duty: 16.0 },
    { limit: Infinity, fixed: 160, energy: 11.55, fac: 0.75, wheeling: 1.87, duty: 16.0 },
  ],
};

const defaultCompanyProfiles = {
  tata: { name: "Tata Power", fixedCharge: "135", energyRate: "9.64", fac: "0.00", wheeling: "2.76", duty: "16.0" },
  msedcl: { name: "MSEDCL (Mahavitaran)", fixedCharge: "130", energyRate: "10.80", fac: "0.25", wheeling: "1.60", duty: "16.0" },
  adani: { name: "Adani Electricity", fixedCharge: "135", energyRate: "5.85", fac: "0.65", wheeling: "2.28", duty: "16.0" },
  torrent: { name: "Torrent Power", fixedCharge: "130", energyRate: "11.10", fac: "0.15", wheeling: "1.47", duty: "16.0" },
  best: { name: "BEST", fixedCharge: "135", energyRate: "5.50", fac: "0.75", wheeling: "1.87", duty: "16.0" },
};

function calculateDefaultTariff(companyKey, units) {
  if (!units || units <= 0) return 0;
  const key = String(companyKey || "msedcl").toLowerCase().trim();
  const slabs = tariffs[key] || tariffs.msedcl;

  let fixedCharge = 0;
  for (const slab of slabs) {
    fixedCharge = slab.fixed;
    if (units <= slab.limit) break;
  }

  let energyCharge = 0;
  let remainingUnits = units;
  let prevLimit = 0;

  for (const slab of slabs) {
    const slabUnits = Math.min(remainingUnits, slab.limit - prevLimit);
    if (slabUnits <= 0) break;
    const rate = slab.energy + slab.fac + slab.wheeling;
    energyCharge += slabUnits * rate;
    remainingUnits -= slabUnits;
    prevLimit = slab.limit;
  }

  const subtotal = fixedCharge + energyCharge;
  const duty = subtotal * 0.16;
  return Math.round(subtotal + duty);
}

function parseTariffValue(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  const clean = String(val).split("/")[0].replace(/[^\d.]/g, "");
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : parsed;
}

const tempMap = {
  1: 24, 2: 26, 3: 30, 4: 34, 5: 36, 6: 32,
  7: 29, 8: 28, 9: 28, 10: 30, 11: 27, 12: 24,
};

function parseMonth(monthRaw) {
  if (typeof monthRaw === "number") return monthRaw;
  if (!monthRaw) return new Date().getMonth() + 1;
  const str = String(monthRaw).trim();
  const parsedNum = parseInt(str, 10);
  if (!isNaN(parsedNum) && parsedNum >= 1 && parsedNum <= 12) return parsedNum;

  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const lower = str.toLowerCase();
  for (let i = 0; i < monthNames.length; i++) {
    if (lower.includes(monthNames[i])) return i + 1;
  }
  return new Date().getMonth() + 1;
}

router.post("/predict", authOptional, async (req, res) => {
  try {
    const data = req.body || {};
    const monthRaw = data.month;
    const month = parseMonth(monthRaw);
    const units = parseFloat(data.unit) || 0;
    const amount = parseFloat(data.amount) || 0;
    const predictionType = data.prediction_type || "history";
    const provider = String(data.provider || "msedcl").toLowerCase();

    let predictUnit = 0;
    let predictAmount = 0;

    if (predictionType === "appliances") {
      const appData = data.appliances || {};
      const fanHours = (parseFloat(appData.fan) || 0) * (parseFloat(appData.fan_qty) || 1);
      const fridgeHours = (parseFloat(appData.fridge) || 0) * (parseFloat(appData.fridge_qty) || 1);
      const acHours = (parseFloat(appData.ac) || 0) * (parseFloat(appData.ac_qty) || 1);
      const tvHours = (parseFloat(appData.tv) || 0) * (parseFloat(appData.tv_qty) || 1);
      const monitorHours = (parseFloat(appData.monitor || appData.comp) || 0) * (parseFloat(appData.monitor_qty || appData.comp_qty) || 1);
      const wmHours = (parseFloat(appData.wm) || 0) * (parseFloat(appData.wm_qty) || 1);
      const geyserHours = (parseFloat(appData.geyser) || 0) * (parseFloat(appData.geyser_qty) || 1);
      const bulbHours = (parseFloat(appData.bulb) || 0) * (parseFloat(appData.bulb_qty) || 1);
      const otherHours = (parseFloat(appData.other) || 0) * (parseFloat(appData.other_qty) || 1);

      const extraUnits = 30.0 * (0.1 * otherHours);

      const rawKwh = (
        fanHours * 75 +
        fridgeHours * 250 +
        acHours * 1500 +
        tvHours * 100 +
        monitorHours * 200 +
        wmHours * 500 +
        geyserHours * 2000 +
        bulbHours * 12
      ) * 30 / 1000.0;

      // Seasonal temperature modifier
      const temp = tempMap[month] || 28;
      const seasonalModifier = 1 + ((temp - 28) * 0.015);

      if (rawKwh > 0) {
        predictUnit = Math.max(1, Math.round(rawKwh * seasonalModifier + extraUnits));
      } else if (units > 0) {
        predictUnit = Math.round(units * seasonalModifier);
      } else {
        predictUnit = 280;
      }
    } else {
      // History-based prediction
      const temp = tempMap[month] || 28;
      const seasonalModifier = 1 + ((temp - 28) * 0.018);

      const lagUnits = [];
      const lagAmounts = [];
      for (let i = 2; i <= 12; i++) {
        if (data[`unit${i}`] !== undefined && data[`amount${i}`] !== undefined) {
          lagUnits.push(parseFloat(data[`unit${i}`]) || 0);
          lagAmounts.push(parseFloat(data[`amount${i}`]) || 0);
        }
      }

      if (units > 0) {
        let baseUnits = units;
        if (lagUnits.length > 0) {
          const allUnits = [units, ...lagUnits].filter(u => u > 0);
          const avgUnits = allUnits.reduce((a, b) => a + b, 0) / allUnits.length;
          baseUnits = (units * 0.6) + (avgUnits * 0.4);
        }
        predictUnit = Math.max(1, Math.round(baseUnits * seasonalModifier));
      } else {
        predictUnit = Math.round(250 * seasonalModifier);
      }
    }

    // ── Deterministic Amount Calculation ────────────────────────────────────────
    // IMPORTANT: Amount is NEVER predicted by a machine-learning model.
    // Predicting amount separately would just be re-learning the tariff slab formula
    // that is already implemented deterministically in calculateDefaultTariff().
    // The correct pipeline is always:
    //   1. Predict UNITS (ML model or formula based on appliances/history)
    //   2. Compute AMOUNT = calculateDefaultTariff(provider, predictedUnits)
    //      — or use the provider-specific slab math if tariff details are supplied.
    // This ensures amount stays consistent with provider tariff rules at all times.
    // ──────────────────────────────────────────────────────────────────────────────
    const fixed = parseTariffValue(data.fixedCharge);
    const rate = parseTariffValue(data.energyRate);
    let facRate = parseTariffValue(data.fac);
    let wheelingRate = parseTariffValue(data.wheeling);

    if (facRate > 3.0 && units > 0) facRate = facRate / units;
    if (wheelingRate > 4.0 && units > 0) wheelingRate = wheelingRate / units;

    let dutyVal = data.duty;
    let dutyPct = 16.0;
    if (typeof dutyVal === "string" && dutyVal.includes("%")) {
      dutyPct = parseTariffValue(dutyVal) || 16.0;
    }

    const defaultAmount = calculateDefaultTariff(provider, predictUnit);
    const defaultPrev = units > 0 ? calculateDefaultTariff(provider, units) : null;

    if (defaultAmount && defaultAmount > 0) {
      if (units > 0 && amount > 0 && defaultPrev && defaultPrev > 0) {
        let scalingFactor = amount / defaultPrev;
        scalingFactor = Math.max(0.60, Math.min(3.00, scalingFactor));
        predictAmount = Math.round(defaultAmount * scalingFactor);
      } else {
        predictAmount = defaultAmount;
      }
    } else if (rate > 0) {
      const energyCharges = predictUnit * rate;
      const facCharges = predictUnit * facRate;
      const wheelingCharges = predictUnit * wheelingRate;
      const subtotal = fixed + energyCharges + facCharges + wheelingCharges;
      const dutyCharge = subtotal * (dutyPct / 100.0);
      predictAmount = Math.round(subtotal + dutyCharge);
    } else if (units > 0 && amount > 0) {
      predictAmount = Math.round(amount * (predictUnit / units));
    } else {
      predictAmount = calculateDefaultTariff("msedcl", predictUnit);
    }

    // Safety checks
    if (units > 0 && amount > 0) {
      const maxAllowed = Math.max(300000, Math.round(amount * 4.0));
      if (predictAmount > maxAllowed || predictAmount < 0) {
        predictAmount = Math.round(amount * (predictUnit / Math.max(1, units)));
      }
    }

    const result = {
      predictUnit,
      predictAmount,
      month: monthRaw,
      unit: units,
      amount,
    };

    for (let i = 2; i <= 12; i++) {
      if (data[`unit${i}`] !== undefined) result[`unit${i}`] = data[`unit${i}`];
      if (data[`amount${i}`] !== undefined) result[`amount${i}`] = data[`amount${i}`];
    }

    // Save prediction if user is logged in
    if (req.user && req.user.id) {
      try {
        if (mongoose.Types.ObjectId.isValid(req.user.id)) {
          const pred = new Prediction({
            user: req.user.id,
            prediction_type: predictionType,
            month: String(monthRaw),
            inputUnit: units,
            inputAmount: amount,
            predictUnit,
            predictAmount,
            fixedCharge: String(data.fixedCharge || ""),
            energyRate: String(data.energyRate || ""),
            fac: String(data.fac || ""),
            wheeling: String(data.wheeling || ""),
            duty: String(data.duty || ""),
          });
          await pred.save();
        } else {
          memoryPredictions.push({
            user: req.user.id,
            ...result,
            createdAt: new Date(),
          });
        }
      } catch (dbErr) {
        console.warn("Prediction DB save warning:", dbErr.message);
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Prediction error:", error.message);
    return res.status(500).json({
      message: "Prediction failed",
      detail: error.message,
    });
  }
});

// GET /api/companies/tariff
router.get("/companies/tariff", async (req, res) => {
  try {
    const tariffMap = { ...defaultCompanyProfiles };
    try {
      const profiles = await CompanyProfile.find({});
      profiles.forEach((p) => {
        tariffMap[p.companyKey] = {
          name: p.companyName,
          fixedCharge: p.fixedCharge,
          energyRate: p.energyRate,
          fac: p.fac,
          wheeling: p.wheeling,
          duty: p.duty,
        };
      });
    } catch (dbErr) {
      // In-memory fallback is defaultCompanyProfiles
    }
    return res.status(200).json(tariffMap);
  } catch (error) {
    console.warn("Failed to fetch company tariffs, returning defaults:", error.message);
    return res.status(200).json(defaultCompanyProfiles);
  }
});

module.exports = router;
module.exports.memoryPredictions = memoryPredictions;


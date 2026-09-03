const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const Bill = require("../models/Bill");
const Prediction = require("../models/Prediction");
const mongoose = require("mongoose");
const { memoryBills } = require("./extractRoute");
const { memoryPredictions } = require("./predictRoute");

// Helper: returns true only for real MongoDB ObjectId strings.
// In-memory user IDs start with "mem_" and must skip Mongoose queries entirely
// to avoid the CastError spam in the logs.
const isMongoId = (id) => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);

// GET /api/history/bills - Fetch all extracted bills for the authenticated user
router.get("/bills", auth, async (req, res) => {
  try {
    let bills = [];

    if (isMongoId(req.user.id)) {
      try {
        bills = await Bill.find({ user: req.user.id }).sort({ createdAt: -1 });
      } catch (dbErr) {
        console.warn("MongoDB unavailable for bill history, using in-memory:", dbErr.message);
      }
    }

    if (!bills || bills.length === 0) {
      bills = memoryBills.filter((b) => b.user === req.user.id);
    }

    return res.json(bills || []);
  } catch (error) {
    console.warn("Error fetching bill history:", error.message);
    return res.json([]);
  }
});

// GET /api/history/predictions - Fetch all predictions for the authenticated user
router.get("/predictions", auth, async (req, res) => {
  try {
    let predictions = [];

    if (isMongoId(req.user.id)) {
      try {
        predictions = await Prediction.find({ user: req.user.id }).sort({ createdAt: -1 });
      } catch (dbErr) {
        console.warn("MongoDB unavailable for predictions history, using in-memory:", dbErr.message);
      }
    }

    if (!predictions || predictions.length === 0) {
      predictions = memoryPredictions.filter((p) => p.user === req.user.id);
    }

    return res.json(predictions || []);
  } catch (error) {
    console.warn("Error fetching prediction history:", error.message);
    return res.json([]);
  }
});

// DELETE /api/history/bills - Clear all extracted bills for the authenticated user
router.delete("/bills", auth, async (req, res) => {
  try {
    if (isMongoId(req.user.id)) {
      try {
        await Bill.deleteMany({ user: req.user.id });
      } catch (dbErr) {
        console.warn("MongoDB unavailable for clearing bill history:", dbErr.message);
      }
    }

    for (let i = memoryBills.length - 1; i >= 0; i--) {
      if (memoryBills[i].user === req.user.id) {
        memoryBills.splice(i, 1);
      }
    }

    return res.json({ message: "Bill history cleared successfully" });
  } catch (error) {
    console.warn("Error clearing bill history:", error.message);
    return res.json({ message: "Bill history cleared" });
  }
});

module.exports = router;

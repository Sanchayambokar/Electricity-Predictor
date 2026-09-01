const mongoose = require("mongoose");

const BillSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  company: {
    type: String,
    default: "—"
  },
  consumerName: {
    type: String,
    default: "—"
  },
  billDate: {
    type: String,
    default: "—"
  },
  dueDate: {
    type: String,
    default: "—"
  },
  units: {
    type: Number,
    default: 0
  },
  amount: {
    type: Number,
    default: 0
  },
  // Provenance: how the bill was entered. "ocr-gemini" = extracted via Gemini Vision,
  // "ocr-tesseract" = extracted via Tesseract OCR, "manual" = manually typed by user.
  source: {
    type: String,
    enum: ["ocr-gemini", "ocr-tesseract", "template-fallback", "manual"],
    default: "ocr-gemini"
  },
  // Per-field provenance map — each value is the source for that specific field.
  // Keys: consumerName, company, billDate, dueDate, units, amount
  fieldSources: {
    type: Map,
    of: String,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Bill", BillSchema);

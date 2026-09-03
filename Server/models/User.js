const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  fname: {
    type: String,
    required: true
  },
  lname: {
    type: String,
    required: true
  },
  email: {
  type: String,
  unique: true,
  required: true
  },
  password: {
    type: String,
    required: true
  },
  resetToken: {
    type: String,
    default: null
  },
  address: { type: String, default: "" },
  provider: { type: String, default: "" },
  meterNumber: { type: String, default: "" },
  plan: { type: String, default: "" },
  connectionType: { type: String, default: "" },
  resetTokenExpiry: {
    type: Date,
    default: null
  }
}, {
  
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});


UserSchema.virtual('initials').get(function() {
  if (!this.fname) return '';
  const first = this.fname.charAt(0).toUpperCase();
  const last = this.lname ? this.lname.charAt(0).toUpperCase() : '';
  return first + last;
});

module.exports = mongoose.model("User", UserSchema);
const mongoose = require("mongoose");

// Lenient schema to avoid breaking if existing documents have different shapes.
// We add common fields while keeping strict: false so older documents remain valid.
const StockistSchema = new mongoose.Schema(
  {
    name: { type: String },
    contactPerson: { type: String },
    phone: { type: String },
    email: { type: String },
    password: { type: String },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
    },
    licenseNumber: String,
    licenseExpiry: Date,
    licenseImageUrl: { type: String },
    // New fields
    dob: Date,
    bloodGroup: String,
    profileImageUrl: { type: String },
    roleType: String, // 'Proprietor' or 'Pharmacist'
    cntxNumber: String,
    // Approval metadata (set by admin)
    approved: { type: Boolean, default: false },
    approvedAt: Date,
    approvedBy: { type: String },
  },
  { strict: false, timestamps: true }
);

module.exports = mongoose.model("Stockist", StockistSchema);

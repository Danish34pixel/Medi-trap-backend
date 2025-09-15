const mongoose = require("mongoose");

// Lenient schema to avoid breaking if existing documents have different shapes.
const StockistSchema = new mongoose.Schema(
  {},
  { strict: false, timestamps: true }
);

module.exports = mongoose.model("Stockist", StockistSchema);

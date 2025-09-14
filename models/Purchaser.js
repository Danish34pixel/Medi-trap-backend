const mongoose = require("mongoose");

const PurchaserSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    contactNo: {
      type: String,
      required: true,
      trim: true,
    },
    aadharImage: {
      type: String, // Cloudinary URL
      required: true,
    },
    photo: {
      type: String, // Cloudinary URL
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Purchaser", PurchaserSchema);

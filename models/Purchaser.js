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
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: false,
    },
    password: {
      type: String,
      required: false,
    },
    aadharImage: {
      type: String, // Cloudinary URL
      required: true,
    },
    photo: {
      type: String, // Cloudinary URL
      required: true,
    },
    // reference to the user/stockist who created this purchaser
    createdBy: {
      type: require("mongoose").Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Purchaser", PurchaserSchema);

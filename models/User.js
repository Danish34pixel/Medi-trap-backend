const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  medicalName: { type: String, required: true },
  ownerName: { type: String, required: true },
  address: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  contactNo: { type: String, required: true },
  drugLicenseNo: { type: String, required: true },
  drugLicenseImage: { type: String },
  password: { type: String, required: true },
});

module.exports = mongoose.model("User", userSchema);

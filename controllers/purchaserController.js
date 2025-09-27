const Purchaser = require("../models/Purchaser");
const fs = require("fs");
const path = require("path");
const { uploadToCloudinary } = require("../config/cloudinary");

// Create purchaser with aadhar image and photo (Cloudinary URLs)
exports.createPurchaser = async (req, res) => {
  try {
    const { fullName, address, contactNo } = req.body;
    // Expecting two files: aadharImage and photo
    if (!req.files || !req.files["aadharImage"] || !req.files["photo"]) {
      return res.status(400).json({
        success: false,
        message: "Aadhar image and photo are required.",
      });
    }
    // Upload the received files to Cloudinary and use secure URLs
    const aadharFile = req.files["aadharImage"][0];
    const photoFile = req.files["photo"][0];

    const aadharUpload = await uploadToCloudinary(aadharFile, "meditrap/purchasers");
    const photoUpload = await uploadToCloudinary(photoFile, "meditrap/purchasers");

    const purchaser = new Purchaser({
      fullName,
      address,
      contactNo,
      aadharImage: aadharUpload.url,
      photo: photoUpload.url,
    });
    await purchaser.save();
    res.status(201).json({ success: true, data: purchaser });
    // Delete local temp files if present
    try {
      const files = [req.files["aadharImage"][0], req.files["photo"][0]];
      files.forEach((f) => {
        if (f && f.path && fs.existsSync(f.path)) {
          fs.unlink(f.path, (err) => {
            if (err) console.error("Failed to remove temp upload:", err);
          });
        }
      });
    } catch (e) {
      // Non-fatal cleanup error
      console.warn("Cleanup error after purchaser creation:", e.message);
    }
  } catch (err) {
    // Log full error on server for debugging
    console.error("PurchaserController error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get all purchasers
exports.getPurchasers = async (req, res) => {
  try {
    const purchasers = await Purchaser.find().sort({ createdAt: -1 });
    res.json({ success: true, data: purchasers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get single purchaser by ID
exports.getPurchaser = async (req, res) => {
  try {
    const { id } = req.params;
    const purchaser = await Purchaser.findById(id);
    if (!purchaser) {
      return res
        .status(404)
        .json({ success: false, message: "Purchaser not found." });
    }
    res.json({ success: true, data: purchaser });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Delete purchaser by ID
exports.deletePurchaser = async (req, res) => {
  try {
    const { id } = req.params;
    const purchaser = await Purchaser.findByIdAndDelete(id);
    if (!purchaser) {
      return res
        .status(404)
        .json({ success: false, message: "Purchaser not found." });
    }
    res.json({ success: true, message: "Purchaser deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

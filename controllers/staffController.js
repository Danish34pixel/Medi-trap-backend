const Staff = require("../models/Staff");
const {
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../config/cloudinary");
const fs = require("fs");

// Create staff with image and aadharCard (uploads to Cloudinary)
exports.createStaff = async (req, res) => {
  try {
    const { fullName, address, contact, email } = req.body;

    if (!req.files || !req.files["image"] || !req.files["aadharCard"]) {
      return res.status(400).json({
        success: false,
        message: "Image and Aadhar card are required.",
      });
    }

    // Upload files to Cloudinary
    const imageFile = req.files["image"][0];
    const aadharFile = req.files["aadharCard"][0];

    const uploadedImage = await uploadToCloudinary(imageFile, "medtek/staff");
    const uploadedAadhar = await uploadToCloudinary(aadharFile, "medtek/staff");

    // Remove local temp files (best-effort)
    try {
      if (imageFile && imageFile.path) fs.unlinkSync(imageFile.path);
      if (aadharFile && aadharFile.path) fs.unlinkSync(aadharFile.path);
    } catch (e) {
      console.warn("Failed to delete temp files:", e);
    }

    const staff = new Staff({
      fullName,
      address,
      contact,
      email,
      image: uploadedImage.url,
      aadharCard: uploadedAadhar.url,
      imagePublicId: uploadedImage.public_id,
      aadharPublicId: uploadedAadhar.public_id,
    });

    await staff.save();
    res.status(201).json({ success: true, data: staff });
  } catch (err) {
    console.error("staffController.createStaff error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getStaffs = async (req, res) => {
  try {
    const data = await Staff.find().sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    console.error("getStaffs error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const staff = await Staff.findById(id);
    if (!staff)
      return res
        .status(404)
        .json({ success: false, message: "Staff not found." });
    res.json({ success: true, data: staff });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const staff = await Staff.findByIdAndDelete(id);
    if (!staff)
      return res
        .status(404)
        .json({ success: false, message: "Staff not found." });

    // Remove images from Cloudinary if public ids exist
    try {
      if (staff.imagePublicId) await deleteFromCloudinary(staff.imagePublicId);
      if (staff.aadharPublicId)
        await deleteFromCloudinary(staff.aadharPublicId);
    } catch (e) {
      console.warn("Failed to delete images from Cloudinary:", e);
    }

    res.json({ success: true, message: "Staff deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

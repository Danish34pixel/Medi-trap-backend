const Purchaser = require("../models/Purchaser");
const { authenticate, isAdmin } = require("../middleware/auth");
const fs = require("fs");
const path = require("path");
const { uploadToCloudinary } = require("../config/cloudinary");

// Create purchaser with aadhar image and photo (Cloudinary URLs)
exports.createPurchaser = async (req, res) => {
  try {
    // If authentication middleware attached a user, prefer it; otherwise allow anonymous creation
    const creatorId = req.user && req.user._id;
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

    const aadharUpload = await uploadToCloudinary(
      aadharFile,
      "meditrap/purchasers"
    );
    const photoUpload = await uploadToCloudinary(
      photoFile,
      "meditrap/purchasers"
    );

    const purchaser = new Purchaser({
      fullName,
      address,
      contactNo,
      aadharImage: aadharUpload.url,
      photo: photoUpload.url,
      createdBy: creatorId || undefined,
    });
    await purchaser.save();
    // Invalidate purchaser lists for this user and global list
    // No cache invalidation here (purchaser caching removed) - keep DB-only flow
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
    console.error(
      "PurchaserController error:",
      err && err.stack ? err.stack : err
    );
    try {
      console.error("Request body keys:", Object.keys(req.body || {}));
      console.error(
        "Request files:",
        Object.keys(req.files || {}).reduce((acc, k) => {
          acc[k] = (req.files[k] || []).map((f) => ({
            originalname: f.originalname,
            size: f.size,
          }));
          return acc;
        }, {})
      );
    } catch (logErr) {
      console.warn(
        "Failed to log request debug info:",
        logErr && logErr.message
      );
    }
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// Get all purchasers
exports.getPurchasers = async (req, res) => {
  try {
    // If requester is admin, return all. Otherwise, return only purchasers created by the user (if authenticated).
    const requester = req.user;
    let query = {};
    if (requester && requester.role === "admin") {
      query = {};
    } else if (requester && requester._id) {
      query = { createdBy: requester._id };
    } else {
      // unauthenticated: return none by default to avoid exposing data
      return res.json({ success: true, data: [] });
    }

    // Use a cache key scoped by requester id or 'all' for admin
    const purchasers = await Purchaser.find(query).sort({ createdAt: -1 });
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
    const requester = req.user;
    const purchaser = await Purchaser.findById(id);
    if (!purchaser) {
      return res
        .status(404)
        .json({ success: false, message: "Purchaser not found." });
    }

    // Allow deletion if admin or owner
    if (
      requester &&
      (requester.role === "admin" ||
        String(purchaser.createdBy) === String(requester._id))
    ) {
      await Purchaser.findByIdAndDelete(id);
      // purchaser cache removed - no invalidation needed
      return res.json({ success: true, message: "Purchaser deleted." });
    }

    return res.status(403).json({
      success: false,
      message: "Not authorized to delete this purchaser.",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

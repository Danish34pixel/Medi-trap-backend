const Stockist = require("../models/Stockist");
const User = require("../models/User");
const bcrypt = require("bcryptjs");

// Get list of stockists
exports.getStockists = async (req, res) => {
  try {
    const data = await Stockist.find().sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    console.error("getStockists error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Create a new stockist
exports.createStockist = async (req, res) => {
  try {
    // Accept flexible shape; the frontend sends a fairly structured object.
    const payload = req.body || {};

    // Minimal validation: require a name/title
    const name =
      payload.name || payload.title || payload.companyName || payload.name;
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Stockist name is required." });
    }

    // Ensure email and phone (if provided) are unique across Users and Stockists
    const emailRaw = payload.email;
    const phoneRaw = payload.phone || payload.contactNo || payload.contact;

    if (emailRaw) {
      const email = String(emailRaw).toLowerCase().trim();
      const [userExists, stockistExists] = await Promise.all([
        User.findOne({ email }).lean(),
        Stockist.findOne({ email }).lean(),
      ]);
      if (userExists) {
        return res
          .status(400)
          .json({ success: false, message: "Email already in use by a user." });
      }
      if (stockistExists) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another stockist.",
        });
      }
    }

    if (phoneRaw) {
      const phone = String(phoneRaw).trim();
      const [userExistsByPhone, stockistExistsByPhone] = await Promise.all([
        User.findOne({ contactNo: phone }).lean(),
        Stockist.findOne({ phone }).lean(),
      ]);
      if (userExistsByPhone) {
        return res.status(400).json({
          success: false,
          message: "Phone number already in use by a user.",
        });
      }
      if (stockistExistsByPhone) {
        return res.status(400).json({
          success: false,
          message: "Phone number already in use by another stockist.",
        });
      }
    }

    // Normalize and hash password (if provided)
    if (emailRaw) payload.email = String(emailRaw).toLowerCase().trim();
    if (phoneRaw) payload.phone = String(phoneRaw).trim();

    if (payload.password) {
      const salt = await bcrypt.genSalt(12);
      payload.password = await bcrypt.hash(String(payload.password), salt);
    }

    const stockist = new Stockist(payload);
    await stockist.save();

    res.status(201).json({ success: true, data: stockist });
  } catch (err) {
    console.error("createStockist error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin-only: generate unique email, contactNo and a temporary password for a stockist
// generateCredentials helper removed — credential generation is not performed on the server.

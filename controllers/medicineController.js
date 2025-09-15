const Medicine = require("../models/Medicine");

exports.getMedicines = async (req, res) => {
  try {
    const data = await Medicine.find().sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    console.error("getMedicines error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

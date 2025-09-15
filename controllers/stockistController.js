const Stockist = require("../models/Stockist");

exports.getStockists = async (req, res) => {
  try {
    const data = await Stockist.find().sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    console.error("getStockists error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

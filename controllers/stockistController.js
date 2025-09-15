const Stockist = require("../models/Stockist");

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

    const stockist = new Stockist(payload);
    await stockist.save();

    res.status(201).json({ success: true, data: stockist });
  } catch (err) {
    console.error("createStockist error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

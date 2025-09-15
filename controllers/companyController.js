const Company = require("../models/Company");

exports.getCompanies = async (req, res) => {
  try {
    const data = await Company.find().sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    console.error("getCompanies error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

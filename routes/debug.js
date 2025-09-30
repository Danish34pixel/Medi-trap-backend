const express = require("express");
const router = express.Router();

function redact(val) {
  if (!val) return null;
  return String(val).length > 6 ? String(val).slice(0, 3) + "***" : "***";
}

router.get("/info", (req, res) => {
  try {
    const allowed = global.__ALLOWED_ORIGINS__ || [];
    res.json({
      success: true,
      allowedOrigins: allowed,
      env: {
        NODE_ENV: process.env.NODE_ENV || null,
        FRONTEND_URL: process.env.FRONTEND_URL
          ? redact(process.env.FRONTEND_URL)
          : null,
        FRONTEND_URLS: process.env.FRONTEND_URLS
          ? redact(process.env.FRONTEND_URLS)
          : null,
        MONGO_URI_PRESENT: !!(
          process.env.MONGO_URI ||
          process.env.MONGODB_URI ||
          process.env.DB_URI
        ),
        SENDGRID: !!(process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY),
        EMAIL_USER: !!process.env.EMAIL_USER,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "debug error" });
  }
});

module.exports = router;

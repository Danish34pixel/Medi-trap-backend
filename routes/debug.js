const express = require("express");
const router = express.Router();
const path = require("path");
const prodMailer = require(path.join(
  __dirname,
  "..",
  "utils",
  "prodMailerHelper"
));

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

// Protected endpoint to run an SMTP check from the running process.
// Accepts POST { to: "recipient@example.com" } and requires header
// `x-debug-token` to equal process.env.DEBUG_TOKEN. This avoids exposing
// an unauthenticated send endpoint in public deployments.
router.post("/email-check", async (req, res) => {
  try {
    const token = req.headers["x-debug-token"] || "";
    if (!process.env.DEBUG_TOKEN) {
      return res.status(403).json({
        success: false,
        message:
          "Email check endpoint disabled on this deployment (no DEBUG_TOKEN set).",
      });
    }
    if (!token || token !== process.env.DEBUG_TOKEN) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid debug token" });
    }

    const to = req.body && req.body.to ? String(req.body.to).trim() : null;
    if (!to)
      return res
        .status(400)
        .json({ success: false, message: "Missing 'to' in body" });

    // Use helper to create transporter and send a lightweight test message.
    const result = await prodMailer.sendTestMail({
      to,
      subject: "Prod SMTP check",
      text: "This is a production SMTP diagnostic message.",
    });
    return res.json({ success: true, result });
  } catch (err) {
    console.error("/debug/email-check error:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Email check failed",
        error: err && err.message,
      });
  }
});

module.exports = router;

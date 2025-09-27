const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { sendMail } = require("../utils/mailer");

// Generate a secure random token (hex)
function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// POST /api/auth/forgot-password
// body: { email }
async function forgotPassword(req, res) {
  try {
    // Dev-only debug: log request origin, ip and body to help diagnose 500s
    if (process.env.NODE_ENV === "development") {
      try {
        console.log(
          "forgotPassword called from Origin=",
          req.headers.origin,
          "IP=",
          req.ip,
          "body=",
          req.body
        );
      } catch (e) {
        console.log("forgotPassword debug log failed", e && e.message);
      }
    }
    const { email } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });

    // Use lean() to avoid hydrating a Mongoose document (which can fail if
    // the stored document has fields that don't match the schema types
    // (e.g. address stored as an object while schema expects a string)).
    const user = await User.findOne({ email: email.toLowerCase() }).lean();
    if (!user)
      return res.status(200).json({
        success: true,
        message: "If an account exists, a reset email has been sent.",
      });

    const token = generateResetToken();
    const expires = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store only a hash of the token in DB using an atomic update to avoid
    // triggering full-document validation when stored fields don't match the
    // current schema (some legacy documents store objects for address or
    // drugLicenseImage). This avoids Cast/Validation errors during save.
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordToken: hashToken(token),
          resetPasswordExpires: new Date(expires),
        },
      }
    );

    // Build reset URL - front-end should have a route to handle this path
    const resetUrl = `${
      process.env.FRONTEND_BASE_URL || "http://localhost:5173"
    }/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;

    const html = `<p>You (or someone else) requested a password reset.</p>
      <p>Click this link to reset your password. This link expires in 15 minutes:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>`;

    let mailResult = null;
    try {
      mailResult = await sendMail({
        to: user.email,
        subject: "Password reset request",
        html,
        text: `Reset your password using this link: ${resetUrl}`,
      });
    } catch (mailErr) {
      // Log mail errors but do not expose them to the client to avoid user enumeration
      console.error("forgotPassword: sendMail failed", mailErr);
      // Continue: we will still return a generic success response so clients can't
      // use this endpoint to detect whether an email exists or to probe mail server state.
      mailResult = { previewUrl: null };
    }

    // Log preview URL server-side (useful during development with Ethereal)
    try {
      const previewUrl =
        mailResult && mailResult.previewUrl ? mailResult.previewUrl : null;
      if (previewUrl) console.log("Ethereal preview URL:", previewUrl);
    } catch (e) {
      // ignore
    }

    // Always return a generic success response to avoid user enumeration
    res.json({
      success: true,
      message: "If an account exists, a reset email has been sent.",
    });
  } catch (err) {
    console.error("forgotPassword error:", err);
    // In development, include the error message/stack to aid debugging.
    if (process.env.NODE_ENV === "development") {
      return res.status(500).json({
        success: false,
        message: "Server error",
        error: err.message,
        stack: err.stack,
      });
    }
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// POST /api/auth/reset-password
// body: { token, email, newPassword }
async function resetPassword(req, res) {
  try {
    const { token, email, newPassword } = req.body;
    if (!token || !email || !newPassword)
      return res.status(400).json({
        success: false,
        message: "token, email and newPassword are required",
      });

    // Find user by email first, then compare hashed token in timing-safe manner
    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+resetPasswordToken +resetPasswordExpires"
    );
    if (!user)
      return res
        .status(400)
        .json({ success: false, message: "Invalid token or email" });

    if (
      !user.resetPasswordExpires ||
      user.resetPasswordExpires.getTime() < Date.now()
    ) {
      return res.status(400).json({ success: false, message: "Token expired" });
    }

    const hashed = hashToken(token);
    const stored = user.resetPasswordToken || "";
    const bufA = Buffer.from(hashed);
    const bufB = Buffer.from(stored);
    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid token or email" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const newHashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = newHashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ success: true, message: "Password reset successful" });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { forgotPassword, resetPassword };

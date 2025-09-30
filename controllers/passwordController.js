const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Stockist = require("../models/Stockist");
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
    console.log("[forgotPassword] Handler reached");
    if (process.env.NODE_ENV === "development") {
      try {
        console.log("[forgotPassword] Incoming request:", {
          origin: req.headers.origin,
          ip: req.ip,
          body: req.body,
        });
      } catch (e) {
        console.log("[forgotPassword] Debug log failed", e && e.message);
      }
    }
    const { email } = req.body;
    console.log("[forgotPassword] Email from body:", email);
    if (!email) {
      console.log("[forgotPassword] No email provided");
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }

    // Try to find the account in User first, then in Stockist.
    const normalizedEmail = email.toLowerCase();
    let account = await User.findOne({ email: normalizedEmail }).lean();
    let accountModel = User;
    if (!account) {
      account = await Stockist.findOne({ email: normalizedEmail }).lean();
      accountModel = Stockist;
    }
    console.log(
      "[forgotPassword] Account found:",
      !!account,
      "model:",
      accountModel.modelName
    );
    if (!account) {
      console.log("[forgotPassword] No user found for email");
      return res.status(200).json({
        success: true,
        message: "If an account exists, a reset email has been sent.",
      });
    }

    const token = generateResetToken();
    const expires = Date.now() + 15 * 60 * 1000; // 15 minutes
    console.log("[forgotPassword] Generated token:", token);

    // Save the hashed token and expiry on whichever model owns the account.
    await accountModel.updateOne(
      { _id: account._id },
      {
        $set: {
          resetPasswordToken: hashToken(token),
          resetPasswordExpires: new Date(expires),
        },
      }
    );
    console.log(
      "[forgotPassword] Token and expiry saved to account (model:",
      accountModel.modelName,
      ")"
    );

    // Prefer an explicit FRONTEND_BASE_URL, then FRONTEND_URL (single URL),
    // then fall back to the known Vercel frontend. This avoids generating
    // localhost links in deployed environments when only FRONTEND_URL is set.
    const frontendBase =
      process.env.FRONTEND_BASE_URL ||
      process.env.FRONTEND_URL ||
      "https://medi-trap-frontend.vercel.app";
    const normalizedBase = String(frontendBase).replace(/\/+$/, "");
    const resetUrl = `${normalizedBase}/reset-password?token=${token}&email=${encodeURIComponent(
      account.email
    )}`;
    console.log("[forgotPassword] Reset URL:", resetUrl);

    const html = `<p>You (or someone else) requested a password reset.</p>
      <p>Click this link to reset your password. This link expires in 15 minutes:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>`;

    let mailResult = null;
    try {
      console.log(
        "[forgotPassword] About to call sendMail for:",
        account.email
      );
      mailResult = await sendMail({
        to: account.email,
        subject: "Password reset request",
        html,
        text: `Reset your password using this link: ${resetUrl}`,
      });
      console.log("[forgotPassword] sendMail result:", mailResult);
    } catch (mailErr) {
      console.error(
        "[forgotPassword] sendMail failed",
        mailErr && mailErr.message
      );
      // Keep the default behavior of not revealing delivery status to callers.
      // However, allow opt-in debug output in the response when DEBUG_EMAIL=true.
      mailResult = { previewUrl: null };
      if (
        process.env.DEBUG_EMAIL === "true" ||
        process.env.NODE_ENV === "development"
      ) {
        // Attach debug field to response so operators can see why delivery failed.
        return res.status(200).json({
          success: true,
          message: "If an account exists, a reset email has been sent.",
          debug: { mailError: mailErr && (mailErr.message || String(mailErr)) },
        });
      }
    }

    try {
      const previewUrl =
        mailResult && mailResult.previewUrl ? mailResult.previewUrl : null;
      if (previewUrl)
        console.log("[forgotPassword] Ethereal preview URL:", previewUrl);
    } catch (e) {
      // ignore
    }

    console.log("[forgotPassword] Responding to client");
    res.json({
      success: true,
      message: "If an account exists, a reset email has been sent.",
    });
  } catch (err) {
    console.error("[forgotPassword] error:", err);
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

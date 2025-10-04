const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Stockist = require("../models/Stockist");
const { uploadToCloudinary } = require("../config/cloudinary");
const {
  upload,
  handleUploadError,
  cleanupUploads,
} = require("../middleware/upload");
// Note: a local `authenticate` implementation (with blacklist support)
// is defined later in this file. Do not import the middleware's
// `authenticate` here to avoid duplicate declaration/conflict.
const {
  forgotPassword,
  resetPassword,
} = require("../controllers/passwordController");
const router = express.Router();

// Rate limiting for auth routes
const rateLimit = require("express-rate-limit");
const isDevelopment = process.env.NODE_ENV === "development";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs (production default)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
});

// Apply rate limiting to auth routes only outside development
if (!isDevelopment) {
  router.use(authLimiter);
}

// Token blacklist for invalidation
const tokenBlacklist = new Set();

// Authenticate middleware (blacklist-aware) - moved up so routes can use it
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.slice(7);

    // Debug: log a short token snippet to help trace which token the client sent
    try {
      console.debug("Auth: tokenSnippet ->", token.slice(0, 12) + "...");
    } catch (e) {}

    // Check if token is blacklisted
    if (tokenBlacklist.has(token)) {
      return res.status(401).json({
        success: false,
        message: "Token has been invalidated.",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Debug: show decoded token payload fields (non-sensitive)
    try {
      console.debug("Auth: decoded ->", {
        userId: decoded && decoded.userId,
        email: decoded && decoded.email,
        role: decoded && decoded.role,
      });
    } catch (e) {}

    let user = null;
    try {
      if (decoded && decoded.role && decoded.role === "stockist") {
        user = await Stockist.findById(decoded.userId).select("-password");
      } else {
        user = await User.findById(decoded.userId).select("-password");
        if (!user) {
          user = await Stockist.findById(decoded.userId).select("-password");
        }
      }
    } catch (e) {
      user = null;
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token is valid but user no longer exists.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Token verification failed.",
    });
  }
};

// @route   POST /api/auth/signup
// @desc    Register a new medical store
// @access  Public
router.post(
  "/signup",
  upload.single("drugLicenseImage"),
  handleUploadError,
  async (req, res) => {
    try {
      const {
        medicalName,
        ownerName,
        address,
        email,
        contactNo,
        drugLicenseNo,
        password,
      } = req.body;

      // Check if required fields are present
      if (
        !medicalName ||
        !ownerName ||
        !address ||
        !email ||
        !contactNo ||
        !drugLicenseNo ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          message: "All fields are required",
        });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Drug license image is required",
        });
      }

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ email }, { drugLicenseNo }],
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message:
            existingUser.email === email
              ? "Email already registered"
              : "Drug license number already registered",
        });
      }

      // Upload image to Cloudinary
      const cloudinaryResult = await uploadToCloudinary(
        req.file,
        "medtek/licenses"
      );

      // Hash password
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create new user
      const user = new User({
        medicalName,
        ownerName,
        address,
        email: email.toLowerCase(),
        contactNo,
        drugLicenseNo: drugLicenseNo.toUpperCase(),
        drugLicenseImage: cloudinaryResult.url,
        password: hashedPassword,
      });

      await user.save();

      // Remove password from response
      const userResponse = user.toObject();
      delete userResponse.password;

      res.status(201).json({
        success: true,
        message: "Medical store registered successfully",
        user: userResponse,
      });
    } catch (error) {
      console.error("Signup error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during registration",
      });
    }
  },
  cleanupUploads
);

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if required fields are present
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find user by email
    let user = await User.findOne({ email: email.toLowerCase() });

    // If no User found, check Stockist collection (admin may have created stockist with password)
    let isStockist = false;
    if (!user) {
      const stockist = await Stockist.findOne({
        email: email.toLowerCase(),
      }).lean();
      if (!stockist || !stockist.password) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid credentials" });
      }

      const isMatchStockist = await bcrypt.compare(password, stockist.password);
      if (!isMatchStockist) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid credentials" });
      }

      // Create a lightweight user-like object for the stockist
      user = {
        _id: stockist._id,
        medicalName: stockist.name || stockist.medicalName || "",
        ownerName: stockist.contactPerson || "",
        address: stockist.address || "",
        email: stockist.email,
        contactNo: stockist.phone || stockist.contact || "",
        role: "stockist",
      };
      isStockist = true;
    } else {
      // Check password for regular User
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid credentials" });
      }
    }

    // Create JWT token
    const payload = {
      userId: user._id,
      email: user.email,
      role: user.role || "stockist",
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d", // Token expires in 7 days
    });

    // Remove password from response (handle Mongoose doc vs plain object)
    let userResponse;
    try {
      userResponse =
        typeof user.toObject === "function" ? user.toObject() : { ...user };
    } catch (e) {
      userResponse = { ...user };
    }
    if (userResponse && userResponse.password) delete userResponse.password;

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: userResponse,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get("/me", authenticate, async (req, res) => {
  try {
    console.log(`/api/auth/me called for userId=${req.user && req.user._id}`);
    res.json({
      success: true,
      user: req.user,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching profile",
    });
  }
});

// Password reset endpoints
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Development-only: send a test email and return preview URL (Ethereal)
if (isDevelopment) {
  const { sendMail } = require("../utils/mailer");
  router.post("/debug/send-test-email", async (req, res) => {
    try {
      const { to, subject, html, text, from } = req.body || {};
      if (!to)
        return res
          .status(400)
          .json({ success: false, message: "to is required" });
      const result = await sendMail({
        to,
        subject: subject || "Test email",
        html,
        text,
        from,
      });
      return res.json({ success: true, previewUrl: result.previewUrl || null });
    } catch (err) {
      console.error("debug send-test-email error:", err && err.message);
      return res
        .status(500)
        .json({ success: false, message: err && err.message });
    }
  });
}

// Protected test-send endpoint for staging/production
// Usage: POST /api/auth/test-send-email { to, subject, html, text }
// Requires: Authorization: Bearer <token>
router.post("/test-send-email", authenticate, async (req, res) => {
  try {
    const { sendMail } = require("../utils/mailer");
    const { to, subject, html, text, from } = req.body || {};
    if (!to)
      return res
        .status(400)
        .json({ success: false, message: "to is required" });

    const result = await sendMail({
      to,
      subject: subject || "Test email",
      html,
      text,
      from,
    });

    // Return provider info but avoid leaking full auth details
    return res.json({
      success: true,
      previewUrl: result.previewUrl || null,
      info: !!result.info,
    });
  } catch (err) {
    console.error("test-send-email error:", err && err.message);
    return res
      .status(500)
      .json({ success: false, message: err && err.message });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put(
  "/profile",
  authenticate,
  upload.single("drugLicenseImage"),
  handleUploadError,
  async (req, res) => {
    try {
      const { medicalName, ownerName, address, contactNo } = req.body;

      const updateData = {};

      // Only update fields that are provided
      if (medicalName) updateData.medicalName = medicalName;
      if (ownerName) updateData.ownerName = ownerName;
      if (address) updateData.address = address;
      if (contactNo) updateData.contactNo = contactNo;

      // Handle image upload if provided
      if (req.file) {
        const cloudinaryResult = await uploadToCloudinary(
          req.file,
          "medtek/licenses"
        );
        updateData.drugLicenseImage = cloudinaryResult.url;
      }

      // Update user
      const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        updateData,
        { new: true, runValidators: true }
      ).select("-password");

      res.json({
        success: true,
        message: "Profile updated successfully",
        user: updatedUser,
      });
    } catch (error) {
      console.error("Update profile error:", error);
      res.status(500).json({
        success: false,
        message: "Server error while updating profile",
      });
    }
  },
  cleanupUploads
);

// @route   POST /api/auth/logout
// @desc    Logout user and invalidate token
// @access  Private
router.post("/logout", authenticate, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      tokenBlacklist.add(token); // Add token to blacklist
    }

    res.json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during logout",
    });
  }
});

module.exports = router;

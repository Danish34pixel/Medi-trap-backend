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

      // Enforce manual approval workflow: only approved stockists can login
      if (!stockist.status || stockist.status !== "approved") {
        if (stockist.status === "declined") {
          return res.status(403).json({ success: false, message: "Your registration was declined by admin." });
        }
        return res.status(403).json({ success: false, message: "Your account is under review. Please wait for admin approval." });
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

// @route   GET /api/auth/users
// @desc    Get all users
// @access  Public
router.get("/users", async (req, res) => {
  try {
    console.log("Fetching all users..."); // Debugging log
    const users = await User.find().select("-password"); // Exclude passwords from the response
    console.log("Users fetched:", users); // Debugging log
    res.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching users",
    });
  }
});

// Approve user
router.patch("/users/:id/approve", async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Persist approval on the User model using existing schema field
    user.isVerified = true;
    // optionally set a timestamp if desired (won't persist unless added to schema)
    // user.approvedAt = new Date();
    await user.save();

    res
      .status(200)
      .json({
        message: "User approved successfully",
        data: { approvedAt: new Date() },
        user,
      });
  } catch (error) {
    console.error("Error approving user:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;

// ------------------------- Purchaser self-signup -------------------------
// POST /api/auth/purchaser-signup
// multipart form: fullName, email, password, aadharNo, aadharImage (file), personalPhoto (file)
router.post(
  "/purchaser-signup",
  upload.fields([
    { name: "aadharImage", maxCount: 1 },
    { name: "personalPhoto", maxCount: 1 },
  ]),
  handleUploadError,
  async (req, res) => {
    try {
      const { fullName, email, password } = req.body || {};

      if (!fullName || !email || !password) {
        return res
          .status(400)
          .json({ success: false, message: "All fields are required" });
      }

      // files required
      if (!req.files || !req.files.aadharImage || !req.files.personalPhoto) {
        return res.status(400).json({
          success: false,
          message: "Aadhar image and personal photo are required",
        });
      }

      // Check if email already exists
      const exists = await User.findOne({ email: email.toLowerCase() });
      if (exists)
        return res
          .status(400)
          .json({ success: false, message: "Email already registered" });

      // Upload files to Cloudinary (best-effort). If upload fails, log and continue
      let aadharUpload = { url: "" };
      let photoUpload = { url: "" };
      try {
        aadharUpload = await uploadToCloudinary(
          req.files.aadharImage[0],
          "medtek/aadhar"
        );
      } catch (uploadErr) {
        console.warn(
          "Aadhar upload failed, continuing without cloud URL:",
          uploadErr && uploadErr.message
        );
      }

      try {
        photoUpload = await uploadToCloudinary(
          req.files.personalPhoto[0],
          "medtek/personal"
        );
      } catch (uploadErr) {
        console.warn(
          "Personal photo upload failed, continuing without cloud URL:",
          uploadErr && uploadErr.message
        );
      }

      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(password, salt);

      // The main User schema is targeted for medical stores and has several
      // required validators (address, contactNo, drugLicenseNo, drugLicenseImage).
      // For purchaser self-signup we supply safe placeholder values so the
      // document validates while still storing purchaser-specific images.
      const user = new User({
        medicalName: fullName,
        ownerName: fullName,
        // provide minimal non-empty values to satisfy schema validators
        address: req.body.address || "N/A",
        email: email.toLowerCase(),
        contactNo: req.body.contactNo || "0000000000",
        // ensure a unique-ish drugLicenseNo so unique index doesn't complain
        drugLicenseNo: `P-${Date.now()}`,
        // use uploaded photo/aadhar as a fallback for license image
        drugLicenseImage: aadharUpload.url || photoUpload.url || "placeholder",
        password: hashedPassword,
        // aadharNo omitted - not required
        aadharImage: aadharUpload.url,
        personalPhoto: photoUpload.url,
        purchasingCardRequested: false,
      });

      // Log the prepared user document (safe fields only) to help debug
      try {
        console.debug("Prepared user for save:", {
          email: user.email,
          medicalName: user.medicalName,
          ownerName: user.ownerName,
          drugLicenseNo: user.drugLicenseNo,
        });
      } catch (e) {}

      await user.save();

      // create JWT
      const payload = { userId: user._id, email: user.email, role: user.role };
      const token = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      const userResp = user.toObject();
      delete userResp.password;

      return res.status(201).json({
        success: true,
        message: "Account created",
        token,
        user: userResp,
      });
    } catch (err) {
      console.error("Purchaser signup error:", err && err.message);
      console.error("Request body:", req.body);
      console.error("Request files:", req.files);
      if (err && err.stack) {
        console.error("Error stack:", err.stack);
      }

      // Mongoose validation errors -> return 400 with details
      if (err.name === "ValidationError") {
        const messages = Object.values(err.errors).map((e) => e.message);
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: messages,
        });
      }

      // Duplicate key (unique index) errors -> 400
      if (err.name === "MongoError" && err.code === 11000) {
        const key = Object.keys(err.keyValue || {}).join(", ") || "field";
        return res.status(400).json({
          success: false,
          message: `Duplicate value for ${key}`,
        });
      }

      const isDev = process.env.NODE_ENV === "development";
      const payload = {
        success: false,
        message: "Server error",
        error: err.message,
      };
      if (isDev && err && err.stack) payload.stack = err.stack;
      return res.status(500).json(payload);
    }
  },
  cleanupUploads
);

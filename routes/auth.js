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
const { authenticate } = require("../middleware/auth");
const { forgotPassword, resetPassword } = require('../controllers/passwordController');
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
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

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

module.exports = router;

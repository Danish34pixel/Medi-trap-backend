const express = require("express");
const router = express.Router();

// Controller
const stockistController = require("../controllers/stockistController");

// Auth middleware
const { authenticate, isAdmin } = require("../middleware/auth");
const {
  upload,
  handleUploadError,
  cleanupUploads,
} = require("../middleware/upload");

// GET /api/stockist - list stockists
router.get("/", stockistController.getStockists);

// POST /api/stockist - create a new stockist (any authenticated user)
router.post("/", authenticate, stockistController.createStockist);

// POST /api/stockist/upload-license - upload license image (multipart) and return Cloudinary URL
router.post(
  "/upload-license",
  authenticate,
  upload.single("licenseImage"),
  stockistController.uploadLicenseImage,
  handleUploadError,
  cleanupUploads
);

// POST /api/stockist/upload-profile - upload profile image
router.post(
  "/upload-profile",
  authenticate,
  upload.single("profileImage"),
  stockistController.uploadProfileImage,
  handleUploadError,
  cleanupUploads
);

// POST /api/stockist/verify-password - verify password and return safe stockist data
router.post("/verify-password", stockistController.verifyStockistPassword);

module.exports = router;

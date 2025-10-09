const express = require("express");
const router = express.Router();
const { upload } = require("../middleware/upload");
const staffController = require("../controllers/staffController");
const { authenticate, isAdmin } = require("../middleware/auth");
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

// POST /api/staff - create staff (expects image and aadharCard files)
// POST /api/staff - create staff (expects image and aadharCard files)
// Only authenticated stockists or admins may create staff
router.post(
  "/",
  authenticate,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "aadharCard", maxCount: 1 },
  ]),
  mongoSanitize(),
  xss(),
  staffController.createStaff
);

// GET /api/staff - list staff
// listing is public but can be filtered by ?stockist=me (requires auth) or ?stockist=<id>
router.get("/", authenticate, staffController.getStaffs);

// GET /api/staff/:id - get staff details
router.get("/:id", authenticate, staffController.getStaff);

// DELETE /api/staff/:id - delete staff (admin or owning stockist)
router.delete("/:id", authenticate, staffController.deleteStaff);

module.exports = router;

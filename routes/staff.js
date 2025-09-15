const express = require("express");
const router = express.Router();
const { upload } = require("../middleware/upload");
const staffController = require("../controllers/staffController");
const { authenticate, isAdmin } = require("../middleware/auth");

// POST /api/staff - create staff (expects image and aadharCard files)
router.post(
  "/",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "aadharCard", maxCount: 1 },
  ]),
  staffController.createStaff
);

// GET /api/staff - list staff
router.get("/", staffController.getStaffs);

// GET /api/staff/:id - get staff details
router.get("/:id", staffController.getStaff);

// DELETE /api/staff/:id - delete staff (admin only)
router.delete("/:id", authenticate, isAdmin, staffController.deleteStaff);

module.exports = router;

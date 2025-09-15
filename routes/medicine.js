const express = require("express");
const router = express.Router();
const medicineController = require("../controllers/medicineController");

const { authenticate, isAdmin } = require("../middleware/auth");

// GET /api/medicine - list medicines
router.get("/", medicineController.getMedicines);

// POST /api/medicine/quick - quick create (admin only)
router.post(
  "/quick",
  authenticate,
  isAdmin,
  medicineController.createMedicineQuick
);

module.exports = router;

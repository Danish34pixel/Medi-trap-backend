const express = require("express");
const router = express.Router();

// Controller
const stockistController = require("../controllers/stockistController");

// Auth middleware
const { authenticate, isAdmin } = require("../middleware/auth");

// GET /api/stockist - list stockists
router.get("/", stockistController.getStockists);

// POST /api/stockist - create a new stockist (admin only)
router.post("/", authenticate, isAdmin, stockistController.createStockist);

module.exports = router;

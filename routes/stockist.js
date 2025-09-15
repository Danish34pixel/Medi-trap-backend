const express = require("express");
const router = express.Router();

// Simple placeholder GET - returns empty list. Replace with real controller later.
const stockistController = require("../controllers/stockistController");

router.get("/", stockistController.getStockists);

module.exports = router;

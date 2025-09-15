const express = require("express");
const router = express.Router();
const companyController = require("../controllers/companyController");
const { authenticate, isAdmin } = require("../middleware/auth");

// GET /api/company - list companies
router.get("/", companyController.getCompanies);

// POST /api/company - create a new company (admin only)
router.post("/", authenticate, isAdmin, companyController.createCompany);

module.exports = router;

const express = require("express");
const router = express.Router();
const { upload: uploadAadhar } = require("../middleware/upload");
const purchaserController = require("../controllers/purchaserController");
const { authenticate } = require("../middleware/auth");
// sanitizers removed per user request
const xss = require("xss-clean");

// POST /api/purchaser - create purchaser with aadhar image
// Accept both aadharImage and photo
// Allow anonymous creation: purchaser creation is a public action (uploads handled server-side)
router.post(
  "/",
  uploadAadhar.fields([
    { name: "aadharImage", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  xss(),
  purchaserController.createPurchaser
);

// GET /api/purchaser - get all purchasers (scoped to user unless admin)
router.get("/", authenticate, purchaserController.getPurchasers);

// GET /api/purchaser/:id - get purchaser details (no auth required for read)
router.get("/:id", purchaserController.getPurchaser);

// DELETE /api/purchaser/:id - delete purchaser by id (auth required)
router.delete("/:id", authenticate, purchaserController.deletePurchaser);

module.exports = router;

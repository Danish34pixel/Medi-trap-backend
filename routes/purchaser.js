const express = require("express");
const router = express.Router();
const { upload: uploadAadhar } = require("../middleware/upload");
const purchaserController = require("../controllers/purchaserController");

// POST /api/purchaser - create purchaser with aadhar image
// Accept both aadharImage and photo
router.post(
  "/",
  uploadAadhar.fields([
    { name: "aadharImage", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  purchaserController.createPurchaser
);

// GET /api/purchaser - get all purchasers
router.get("/", purchaserController.getPurchasers);

// DELETE /api/purchaser/:id - delete purchaser by id
router.delete("/:id", purchaserController.deletePurchaser);

module.exports = router;

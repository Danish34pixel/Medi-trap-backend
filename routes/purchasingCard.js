const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Stockist = require("../models/Stockist");
const PurchaseCardRequest = require("../models/PurchaseCardRequest");
const { authenticate, isAdmin } = require("../middleware/auth");
const { sendMail } = require("../utils/mailer");

// POST /api/purchasing-card/request
// Body: { stockistIds: [id1, id2, id3] }
// Creates a request, requires at least 3 stockists, notifies them by email
router.post("/request", authenticate, async (req, res) => {
  try {
    const requester = req.user;
    if (!requester)
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });

    console.debug("Purchasing-card request by:", {
      requesterId: requester && requester._id,
      email: requester && requester.email,
    });
    console.debug("Request body:", req.body);

    const { stockistIds } = req.body || {};
    if (!Array.isArray(stockistIds) || stockistIds.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Please select at least 3 stockists",
      });
    }

    // Validate stockists exist
    const stockists = await Stockist.find({ _id: { $in: stockistIds } }).lean();
    if (!stockists || stockists.length < 3) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid stockist selection" });
    }

    // Create request and generate per-stockist approval tokens
    const crypto = require("crypto");
    const approvalTokens = stockistIds.map((sid) => ({
      stockist: sid,
      token: crypto.randomBytes(18).toString("hex"),
      used: false,
    }));

    const reqDoc = new PurchaseCardRequest({
      requester: requester._id,
      stockists: stockistIds,
      approvalTokens,
    });
    await reqDoc.save();

    console.debug("PurchaseCardRequest saved:", { id: reqDoc._id });

    // Mark user as requested for quick UI feedback
    requester.purchasingCardRequested = true;
    await requester.save();

    // Notify selected stockists via email (best-effort). Do not await each
    // sendMail serially to avoid long blocking operations; run them and
    // catch errors so promise rejections don't escape.
    for (const s of stockists) {
      if (!s || !s.email) continue;
      try {
        const tokenObj = reqDoc.approvalTokens.find(
          (t) => String(t.stockist) === String(s._id)
        );
        const approveLink = tokenObj
          ? `${
              process.env.FRONTEND_URL || "http://localhost:5173"
            }/approve?token=${tokenObj.token}`
          : `${process.env.FRONTEND_URL || "http://localhost:5173"}/`;

        // fire-and-forget with explicit catch
        sendMail({
          to: s.email,
          subject: "Purchasing Card Approval Request",
          html: `<p>Hello ${s.name || s.contactPerson || "Stockist"},</p>
                  <p>${
                    requester.medicalName || requester.email
                  } has requested a Purchasing Card and selected you as a verifier. You may approve the request by clicking the button below.</p>
                  <p><a href="${approveLink}" style="display:inline-block;padding:10px 14px;background:#0ea5a4;color:white;border-radius:6px;text-decoration:none">Approve Request</a></p>
                  <p>Request ID: ${reqDoc._id}</p>`,
        }).catch((mailErr) => {
          console.warn(
            "Failed to notify stockist (async):",
            s._id,
            mailErr && mailErr.message
          );
        });
      } catch (mailErr) {
        console.warn(
          "Failed to schedule notification for stockist",
          s && s._id,
          mailErr && mailErr.message
        );
      }
    }

    return res.json({
      success: true,
      message: "Request submitted and stockists notified",
      requestId: reqDoc._id,
    });
  } catch (err) {
    console.error("Purchasing card request error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/purchasing-card/requests - stockist (authenticated) can list pending requests including those where they are listed
router.get("/requests", authenticate, async (req, res) => {
  try {
    const user = req.user;
    // try to find a stockist record that matches the authenticated user id (if token is stockist)
    let stockist = null;
    try {
      stockist = await Stockist.findOne({ email: user.email });
    } catch (e) {}

    if (!stockist)
      return res.status(403).json({
        success: false,
        message: "Only stockists can list approval requests",
      });

    const requests = await PurchaseCardRequest.find({
      stockists: stockist._id,
      status: "pending",
    })
      .populate("requester", "medicalName email")
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: requests });
  } catch (err) {
    console.error("List requests error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/purchasing-card/approve/:requestId - stockist approves the request
router.post("/approve/:requestId", authenticate, async (req, res) => {
  try {
    const user = req.user;
    let stockist = null;
    try {
      stockist = await Stockist.findOne({ email: user.email });
    } catch (e) {}
    if (!stockist)
      return res.status(403).json({
        success: false,
        message: "Only stockists can approve requests",
      });

    const { requestId } = req.params;
    const reqDoc = await PurchaseCardRequest.findById(requestId);
    if (!reqDoc)
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    if (reqDoc.status !== "pending")
      return res
        .status(400)
        .json({ success: false, message: "Request no longer pending" });

    // If stockist already approved, ignore
    if (
      reqDoc.approvals.some((a) => String(a.stockist) === String(stockist._id))
    ) {
      return res.json({ success: true, message: "Already approved" });
    }

    reqDoc.approvals.push({ stockist: stockist._id, approvedAt: new Date() });

    // If approvals reach 3, mark approved and grant purchasing card to requester
    if (reqDoc.approvals.length >= 3) {
      reqDoc.status = "approved";
      reqDoc.approvedAt = new Date();
      await reqDoc.save();

      // Grant card to user
      const userDoc = await User.findById(reqDoc.requester);
      if (userDoc) {
        userDoc.hasPurchasingCard = true;
        userDoc.purchasingCardRequested = false;
        await userDoc.save();
      }

      return res.json({
        success: true,
        message: "Request approved and purchaser granted",
        approvals: reqDoc.approvals.length,
      });
    }

    await reqDoc.save();
    return res.json({
      success: true,
      message: "Approval recorded",
      approvals: reqDoc.approvals.length,
    });
  } catch (err) {
    console.error("Approve request error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

// GET /api/purchasing-card/approve-web?token=...  (public link clicked from email)
router.get("/approve-web", async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token) return res.status(400).send("Missing token");

    const reqDoc = await PurchaseCardRequest.findOne({
      "approvalTokens.token": token,
    });
    if (!reqDoc)
      return res.status(404).send("Request not found or token invalid");
    if (reqDoc.status !== "pending")
      return res.status(400).send("Request not pending");

    // Find the token entry
    const tEntry = reqDoc.approvalTokens.find(
      (t) => t.token === token && !t.used
    );
    if (!tEntry) return res.status(400).send("Token already used or invalid");

    // mark token used
    tEntry.used = true;
    reqDoc.approvals.push({
      stockist: tEntry.stockist,
      approvedAt: new Date(),
    });

    // If approvals reach 3, mark approved and grant purchasing card
    if (reqDoc.approvals.length >= 3) {
      reqDoc.status = "approved";
      reqDoc.approvedAt = new Date();
      await reqDoc.save();

      const userDoc = await User.findById(reqDoc.requester);
      if (userDoc) {
        userDoc.hasPurchasingCard = true;
        userDoc.purchasingCardRequested = false;
        await userDoc.save();
      }

      // Redirect to a small success page or simply send success
      return res.send(
        "Thank you — request approved and purchasing card granted."
      );
    }

    await reqDoc.save();
    return res.send("Thank you — your approval has been recorded.");
  } catch (err) {
    console.error("Approve-web error:", err);
    return res.status(500).send("Server error");
  }
});

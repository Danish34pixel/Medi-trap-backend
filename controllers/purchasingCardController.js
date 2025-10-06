const PurchasingRequest = require("../models/PurchasingRequest");
const Purchaser = require("../models/Purchaser");
const Stockist = require("../models/Stockist");
const { sendMail } = require("../utils/mailer");

// Create a purchasing-card request and notify selected stockists
exports.createRequest = async (req, res) => {
  try {
    const { stockistIds, requester } = req.body;
    if (!Array.isArray(stockistIds) || stockistIds.length < 3) {
      return res
        .status(400)
        .json({ success: false, message: "Select at least 3 stockists" });
    }

    const purchReq = new PurchasingRequest({
      stockistIds,
      requester,
      purchaserData: req.body.purchaserData || {},
    });
    await purchReq.save();

    // Notify stockists by email when possible
    const stockists = await Stockist.find({ _id: { $in: stockistIds } });
    for (const s of stockists) {
      try {
        if (s.email) {
          // Build an approval link which will call the backend approve-via-link endpoint
          const backendBase =
            process.env.BACKEND_URL ||
            `http://localhost:${process.env.PORT || 5000}`;
          const approveLink = `${backendBase}/api/purchasing-card/approve-link/${purchReq._id}/${s._id}`;

          const htmlBody = `<p>A purchaser <strong>${
            requester?.fullName || requester?.email || "Unknown"
          }</strong> has requested purchasing card access.</p>
            <p>Request ID: <code>${purchReq._id}</code></p>
            <p>Please click the button below to approve the request:</p>
            <p style="margin-top:18px"><a href="${approveLink}" style="background:#0ea5e9;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">Approve Request</a></p>
            <p>If the request receives 3 approvals it will be activated and you will be redirected to the purchaser details page.</p>`;

          await sendMail({
            to: s.email,
            subject: "Purchasing card approval requested",
            text: `A purchaser (${
              requester?.fullName || requester?.email || "Unknown"
            }) has requested purchasing card access. Request ID ${
              purchReq._id
            }. Visit: ${approveLink}`,
            html: htmlBody,
          });
        }
      } catch (e) {
        console.warn("Failed to send mail to stockist", s._id, e.message);
      }
    }

    res.json({ success: true, message: "Requested", data: purchReq });
  } catch (err) {
    console.error("createRequest error", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Approve via a simple GET link (used in email button). This will perform
// the same approval logic as the POST approve endpoint and then redirect
// the user to the frontend. If approvals reach threshold and a Purchaser is
// created, we redirect to the purchaser details page.
exports.approveViaLink = async (req, res) => {
  try {
    const { id, stockistId } = req.params; // id is request id
    if (!stockistId) {
      return res.status(400).send("stockistId required");
    }

    const reqDoc = await PurchasingRequest.findById(id);
    if (!reqDoc) return res.status(404).send("Request not found");
    if (reqDoc.status !== "pending") {
      // Already processed
      const frontend = process.env.FRONTEND_URL || `http://localhost:5173`;
      return res.redirect(frontend);
    }

    if (
      reqDoc.approvals.some((a) => String(a.stockistId) === String(stockistId))
    ) {
      const frontend = process.env.FRONTEND_URL || `http://localhost:5173`;
      return res.redirect(frontend);
    }

    reqDoc.approvals.push({ stockistId, approvedAt: new Date() });

    let createdPurchaser = null;
    if (reqDoc.approvals.length >= 3) {
      reqDoc.status = "approved";
      try {
        const data = reqDoc.purchaserData || {};
        const purchaser = new Purchaser({
          fullName: data.fullName || reqDoc.requester?.fullName || "Unnamed",
          address: data.address || "",
          contactNo: data.contactNo || "",
          aadharImage: data.aadharImage || "",
          photo: data.photo || "",
        });
        createdPurchaser = await purchaser.save();
      } catch (e) {
        console.warn(
          "Failed to create purchaser after approvals (link)",
          e.message
        );
      }
    }

    await reqDoc.save();

    const frontend = process.env.FRONTEND_URL || `http://localhost:5173`;
    if (createdPurchaser && createdPurchaser._id) {
      return res.redirect(`${frontend}/purchaser/${createdPurchaser._id}`);
    }

    // Not yet fully approved - redirect to a pending notification page or the frontend root
    return res.redirect(
      `${frontend}/?purchasing_request=${reqDoc._id}&status=pending`
    );
  } catch (err) {
    console.error("approveViaLink error", err);
    return res.status(500).send("Internal server error");
  }
};

// List pending requests (for stockists/admin)
exports.listRequests = async (req, res) => {
  try {
    const reqs = await PurchasingRequest.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .populate("stockistIds");
    res.json({ success: true, data: reqs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Approve a request by stockist (id param is request id)
exports.approve = async (req, res) => {
  try {
    const { id } = req.params; // request id
    const { stockistId } = req.body; // approving stockist id
    if (!stockistId)
      return res
        .status(400)
        .json({ success: false, message: "stockistId required" });

    const reqDoc = await PurchasingRequest.findById(id);
    if (!reqDoc)
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    if (reqDoc.status !== "pending")
      return res
        .status(400)
        .json({ success: false, message: "Request already processed" });

    // avoid duplicate approvals
    if (
      reqDoc.approvals.some((a) => String(a.stockistId) === String(stockistId))
    ) {
      return res.json({ success: true, message: "Already approved" });
    }

    reqDoc.approvals.push({ stockistId, approvedAt: new Date() });

    // if approvals >= 3, mark approved and create purchaser
    if (reqDoc.approvals.length >= 3) {
      reqDoc.status = "approved";
      // create purchaser from purchaserData
      try {
        const data = reqDoc.purchaserData || {};
        const purchaser = new Purchaser({
          fullName: data.fullName || reqDoc.requester?.fullName || "Unnamed",
          address: data.address || "",
          contactNo: data.contactNo || "",
          aadharImage: data.aadharImage || "",
          photo: data.photo || "",
        });
        await purchaser.save();
      } catch (e) {
        console.warn("Failed to create purchaser after approvals", e.message);
      }
    }

    await reqDoc.save();
    res.json({ success: true, data: reqDoc });
  } catch (err) {
    console.error("approve error", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

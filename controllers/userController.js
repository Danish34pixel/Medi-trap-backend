const User = require("../models/User");
const AdminAudit = require("../models/AdminAudit");

// GET /api/user - list users (basic, paginated optional)
exports.list = async (req, res) => {
  try {
    // Optional filtering by status: processing|approved|declined
    const { status, page = 1, limit = 50 } = req.query;
    const q = {};
    if (status === "approved") q.approved = true;
    else if (status === "declined") q.declined = true;
    else if (status === "processing") q.approved = { $ne: true };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const [items, total] = await Promise.all([
      User.find(q)
        .skip((pageNum - 1) * perPage)
        .limit(perPage)
        .lean()
        .exec(),
      User.countDocuments(q),
    ]);

    return res.json({
      success: true,
      data: items,
      meta: { total, page: pageNum, limit: perPage },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to list users" });
  }
};

// GET /api/user/:id - get single user
exports.get = async (req, res) => {
  try {
    const u = await User.findById(req.params.id).lean().exec();
    if (!u)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    return res.json({ success: true, data: u });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch user" });
  }
};

// PATCH /api/user/:id/approve - mark approved
exports.approve = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    u.approved = true;
    u.declined = false;
    u.approvedAt = new Date();
    await u.save();
    // Create audit record
    try {
      await AdminAudit.create({
        actor: req.user && req.user._id,
        actorEmail:
          (req.user && (req.user.email || req.user.contactNo)) || null,
        targetUser: u._id,
        action: "approve",
        ip: req.ip,
        userAgent: req.get("User-Agent") || null,
      });
    } catch (e) {
      console.warn("Failed to create audit record", e && e.message);
    }

    return res.json({ success: true, data: { approvedAt: u.approvedAt } });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to approve user" });
  }
};

// PATCH /api/user/:id/decline - mark declined
exports.decline = async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    u.declined = true;
    u.approved = false;
    await u.save();
    // Create audit record for decline
    try {
      await AdminAudit.create({
        actor: req.user && req.user._id,
        actorEmail:
          (req.user && (req.user.email || req.user.contactNo)) || null,
        targetUser: u._id,
        action: "decline",
        ip: req.ip,
        userAgent: req.get("User-Agent") || null,
      });
    } catch (e) {
      console.warn("Failed to create audit record", e && e.message);
    }

    return res.json({ success: true, data: {} });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to decline user" });
  }
};

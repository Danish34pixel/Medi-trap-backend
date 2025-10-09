const Stockist = require("../models/Stockist");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { uploadToCloudinary } = require("../config/cloudinary");
const cache = require("../utils/cache");

// Get list of stockists
exports.getStockists = async (req, res) => {
  try {
    const cacheKey = 'stockists:all';
    const cached = await cache.getJson(cacheKey);
    if (cached) {
      console.log(`getStockists: cache hit -> ${cacheKey}`);
      return res.json({ success: true, data: cached, cached: true });
    }

    const data = await Stockist.find().sort({ createdAt: -1 });
    await cache.setJson(cacheKey, data);
    console.log(`getStockists: cache set -> ${cacheKey}`);
    res.json({ success: true, data });
  } catch (err) {
    console.error("getStockists error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Upload a license image (server-side) and return the Cloudinary URL
exports.uploadLicenseImage = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    // Use a specific folder for stockist licenses
    const folder = "stockist drug lisence";
    const result = await uploadToCloudinary(req.file, folder);

    return res
      .status(200)
      .json({ success: true, url: result.url, public_id: result.public_id });
  } catch (err) {
    console.error("uploadLicenseImage error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Upload profile image for stockist and return Cloudinary URL
exports.uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const folder = "stockist image";
    const result = await uploadToCloudinary(req.file, folder);

    return res
      .status(200)
      .json({ success: true, url: result.url, public_id: result.public_id });
  } catch (err) {
    console.error("uploadProfileImage error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Create a new stockist
exports.createStockist = async (req, res) => {
  try {
    // Accept flexible shape; the frontend sends a fairly structured object.
    const payload = req.body || {};

    // Minimal validation: require a name/title
    const name =
      payload.name || payload.title || payload.companyName || payload.name;
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Stockist name is required." });
    }

    // Ensure email and phone (if provided) are unique across Users and Stockists
    const emailRaw = payload.email;
    const phoneRaw = payload.phone || payload.contactNo || payload.contact;

    if (emailRaw) {
      const email = String(emailRaw).toLowerCase().trim();
      const [userExists, stockistExists] = await Promise.all([
        User.findOne({ email }).lean(),
        Stockist.findOne({ email }).lean(),
      ]);
      if (userExists) {
        return res
          .status(400)
          .json({ success: false, message: "Email already in use by a user." });
      }
      if (stockistExists) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another stockist.",
        });
      }
    }

    if (phoneRaw) {
      const phone = String(phoneRaw).trim();
      const [userExistsByPhone, stockistExistsByPhone] = await Promise.all([
        User.findOne({ contactNo: phone }).lean(),
        Stockist.findOne({ phone }).lean(),
      ]);
      if (userExistsByPhone) {
        return res.status(400).json({
          success: false,
          message: "Phone number already in use by a user.",
        });
      }
      if (stockistExistsByPhone) {
        return res.status(400).json({
          success: false,
          message: "Phone number already in use by another stockist.",
        });
      }
    }

    // Normalize and hash password (if provided)
    if (emailRaw) payload.email = String(emailRaw).toLowerCase().trim();
    if (phoneRaw) payload.phone = String(phoneRaw).trim();

    if (payload.password) {
      const salt = await bcrypt.genSalt(12);
      payload.password = await bcrypt.hash(String(payload.password), salt);
    }

    // Normalize license image url if provided
    if (payload.licenseImageUrl) {
      try {
        payload.licenseImageUrl = String(payload.licenseImageUrl).trim();
      } catch (e) {
        // ignore malformed value and delete
        delete payload.licenseImageUrl;
      }
    }

    // New fields normalization
    if (payload.dob) {
      try {
        payload.dob = new Date(payload.dob);
      } catch (e) {
        delete payload.dob;
      }
    }

    if (payload.bloodGroup) {
      payload.bloodGroup = String(payload.bloodGroup).trim();
    }

    if (payload.profileImageUrl) {
      try {
        payload.profileImageUrl = String(payload.profileImageUrl).trim();
      } catch (e) {
        delete payload.profileImageUrl;
      }
    }

    if (payload.roleType) payload.roleType = String(payload.roleType).trim();
    if (payload.cntxNumber)
      payload.cntxNumber = String(payload.cntxNumber).trim();

    // Ensure status is set to processing for new created stockists
    if (!payload.status) payload.status = "processing";

    const stockist = new Stockist(payload);
    await stockist.save();

    // invalidate stockist list
    try { await cache.del('stockists:all'); } catch (e) {}

    res.status(201).json({ success: true, data: stockist });
  } catch (err) {
    console.error("createStockist error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Public registration: create a stockist and return a JWT for immediate use
exports.registerStockist = async (req, res) => {
  try {
    const payload = req.body || {};

    // Minimal validation: require a name/title
    const name =
      payload.name || payload.title || payload.companyName || payload.name;
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Stockist name is required." });
    }

    // Ensure email and phone uniqueness (same checks as createStockist)
    const emailRaw = payload.email;
    const phoneRaw = payload.phone || payload.contactNo || payload.contact;

    if (emailRaw) {
      const email = String(emailRaw).toLowerCase().trim();
      const [userExists, stockistExists] = await Promise.all([
        User.findOne({ email }).lean(),
        Stockist.findOne({ email }).lean(),
      ]);
      if (userExists) {
        return res
          .status(400)
          .json({ success: false, message: "Email already in use by a user." });
      }
      if (stockistExists) {
        return res.status(400).json({
          success: false,
          message: "Email already in use by another stockist.",
        });
      }
    }

    if (phoneRaw) {
      const phone = String(phoneRaw).trim();
      const [userExistsByPhone, stockistExistsByPhone] = await Promise.all([
        User.findOne({ contactNo: phone }).lean(),
        Stockist.findOne({ phone }).lean(),
      ]);
      if (userExistsByPhone) {
        return res.status(400).json({
          success: false,
          message: "Phone number already in use by a user.",
        });
      }
      if (stockistExistsByPhone) {
        return res.status(400).json({
          success: false,
          message: "Phone number already in use by another stockist.",
        });
      }
    }

    if (emailRaw) payload.email = String(emailRaw).toLowerCase().trim();
    if (phoneRaw) payload.phone = String(phoneRaw).trim();

    if (payload.password) {
      const salt = await bcrypt.genSalt(12);
      payload.password = await bcrypt.hash(String(payload.password), salt);
    }

    if (payload.licenseImageUrl) {
      try {
        payload.licenseImageUrl = String(payload.licenseImageUrl).trim();
      } catch (e) {
        delete payload.licenseImageUrl;
      }
    }

    if (payload.dob) {
      try {
        payload.dob = new Date(payload.dob);
      } catch (e) {
        delete payload.dob;
      }
    }

    if (payload.bloodGroup)
      payload.bloodGroup = String(payload.bloodGroup).trim();
    if (payload.profileImageUrl) {
      try {
        payload.profileImageUrl = String(payload.profileImageUrl).trim();
      } catch (e) {
        delete payload.profileImageUrl;
      }
    }
    if (payload.roleType) payload.roleType = String(payload.roleType).trim();
    if (payload.cntxNumber)
      payload.cntxNumber = String(payload.cntxNumber).trim();

    // Set status to processing for manual verification flow
    payload.status = "processing";
    payload.declined = false;

    const stockist = new Stockist(payload);
    await stockist.save();

    // invalidate stockist list
    try { await cache.del('stockists:all'); } catch (e) {}

    // Generate a JWT for the newly registered stockist (optional)
    const token = jwt.sign(
      { userId: stockist._id, role: "stockist" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({ success: true, data: stockist, token });
  } catch (err) {
    console.error("registerStockist error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Verify stockist password (used by QR-protected detail view)
exports.verifyStockistPassword = async (req, res) => {
  try {
    const { id, password } = req.body || {};
    if (!id || !password) {
      return res
        .status(400)
        .json({ success: false, message: "id and password are required" });
    }

    const stockist = await Stockist.findById(id).lean();
    if (!stockist || !stockist.password) {
      return res
        .status(404)
        .json({ success: false, message: "Stockist not found" });
    }

    const match = await bcrypt.compare(
      String(password),
      String(stockist.password)
    );
    if (!match) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid password" });
    }

    // Return safe fields only
    const safe = {
      _id: stockist._id,
      name: stockist.name,
      firmName: stockist.name,
      contactPerson: stockist.contactPerson,
      phone: stockist.phone,
      email: stockist.email,
      address: stockist.address || {},
      dob: stockist.dob || null,
      bloodGroup: stockist.bloodGroup || null,
      roleType: stockist.roleType || null,
      cntxNumber: stockist.cntxNumber || null,
      profileImageUrl: stockist.profileImageUrl || null,
      licenseImageUrl: stockist.licenseImageUrl || null,
    };

    return res.status(200).json({ success: true, data: safe });
  } catch (err) {
    console.error("verifyStockistPassword error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Get a single stockist by id (safe fields)
exports.getStockistById = async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!id)
      return res
        .status(400)
        .json({ success: false, message: "Stockist id required" });
    const stockist = await Stockist.findById(id).lean();
    if (!stockist)
      return res
        .status(404)
        .json({ success: false, message: "Stockist not found" });
    const safe = {
      _id: stockist._id,
      name: stockist.name,
      companyName: stockist.companyName || stockist.name,
      title: stockist.title || stockist.name,
      profileImageUrl: stockist.profileImageUrl || null,
      licenseImageUrl: stockist.licenseImageUrl || null,
      address: stockist.address || {},
      phone: stockist.phone || null,
      email: stockist.email || null,
      roleType: stockist.roleType || null,
      declined: !!stockist.declined, // Include declined flag
      approved: !!stockist.approved,
      status: stockist.status || "processing",
      approvedAt: stockist.approvedAt || null,
    };
    return res.status(200).json({ success: true, data: safe });
  } catch (err) {
    console.error("getStockistById error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Admin-only: approve a stockist (set approved flag and record who approved)
exports.approveStockist = async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!id)
      return res
        .status(400)
        .json({ success: false, message: "Stockist id required" });

    const stockist = await Stockist.findById(id);
    if (!stockist)
      return res
        .status(404)
        .json({ success: false, message: "Stockist not found" });

    // idempotent: if already approved, return success
    if (stockist.approved && stockist.status === "approved") {
      return res.json({
        success: true,
        message: "Already approved",
        data: stockist,
      });
    }

    stockist.approved = true;
    stockist.declined = false;
    stockist.status = "approved";
    stockist.approvedAt = new Date();
    // record admin id if available on req.user (authenticate middleware attaches it)
    if (req.user && (req.user.id || req.user._id)) stockist.approvedBy = req.user.id || req.user._id;

    await stockist.save();

    return res.json({
      success: true,
      message: "Stockist approved",
      data: stockist,
    });
  } catch (err) {
    console.error("approveStockist error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Admin-only: decline a stockist (delete from database)
exports.declineStockist = async (req, res) => {
  try {
    const { id } = req.params || {};
    if (!id)
      return res
        .status(400)
        .json({ success: false, message: "Stockist id required" });

    const stockist = await Stockist.findById(id);
    if (!stockist)
      return res
        .status(404)
        .json({ success: false, message: "Stockist not found" });

    // Mark as declined instead of deleting so we can show feedback to the applicant
    stockist.declined = true;
    stockist.approved = false;
    stockist.status = "declined";
    stockist.declinedAt = new Date();
    await stockist.save();

    return res.json({
      success: true,
      message: "Stockist declined",
      data: stockist,
    });
  } catch (err) {
    console.error("declineStockist error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Admin-only: generate unique email, contactNo and a temporary password for a stockist
// generateCredentials helper removed — credential generation is not performed on the server.

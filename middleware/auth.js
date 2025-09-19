const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Stockist = require("../models/Stockist");

// Middleware to authenticate JWT token
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Try to resolve the token owner. Prefer the role hint in the token if present.
    let user = null;
    try {
      if (decoded && decoded.role && decoded.role === "stockist") {
        user = await Stockist.findById(decoded.userId).select("-password");
      } else {
        // default: look up regular User first
        user = await User.findById(decoded.userId).select("-password");
        // if not found, try Stockist as a fallback (handles tokens issued for stockists)
        if (!user) {
          user = await Stockist.findById(decoded.userId).select("-password");
        }
      }
    } catch (e) {
      user = null;
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token is valid but user no longer exists.",
      });
    }

    // Attach user to request object
    // ensure a role is present for stockist docs so downstream role checks work
    try {
      if (user && !user.role) {
        // prefer role from token if present, otherwise default to 'stockist'
        user.role = (decoded && decoded.role) || "stockist";
      }
    } catch (e) {
      // ignore
    }
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token.",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Token verification failed.",
    });
  }
};

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
    });
  }
};

module.exports = {
  authenticate,
  isAdmin,
};

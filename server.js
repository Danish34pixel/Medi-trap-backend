// Load environment variables. Resolve files relative to this file's
// directory first (Backend/), then fall back to the process cwd. This
// avoids issues when nodemon or scripts run from the repository root.
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

const envCandidates = [
  path.join(__dirname, "config.env"),
  path.join(__dirname, ".env"),
  path.join(process.cwd(), "config.env"),
  path.join(process.cwd(), ".env"),
];

let loaded = false;
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    console.log(`Loaded environment from ${p}`);
    loaded = true;
    break;
  }
}

if (!loaded) {
  // No env file found in Backend or current working dir. Still call dotenv
  // (no-op) to keep behavior consistent, but warn the user.
  dotenv.config();
  console.warn(
    "No config.env or .env file found in Backend or current working directory. Environment variables may be missing."
  );
}
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

// Import routes (case-robust): try multiple casings and fall back to a stub router

const tryRequireRoute = (basePath) => {
  const variants = [
    basePath,
    basePath.toLowerCase(),
    basePath[0].toUpperCase() + basePath.slice(1),
  ];
  for (const v of variants) {
    try {
      // Attempt require relative to this file
      return require(`./routes/${v}`);
    } catch (err) {
      // continue trying other variants
    }
    try {
      // Attempt alternate relative path (some shims use ../Backend/routes)
      return require(`../routes/${v}`);
    } catch (err) {
      // continue
    }
  }

  // If none of the variants worked, return a harmless router that responds
  // with a 501 so the server doesn't crash on startup in deployments where
  // the file is missing or differently named.
  const stub = express.Router();
  stub.use((req, res) =>
    res.status(501).json({
      success: false,
      message: "Route not implemented on this deployment.",
    })
  );
  return stub;
};

// Import route modules using the resilient helper
const authRoutes = tryRequireRoute("auth");
const purchaserRoutes = tryRequireRoute("Purchaser");
const stockistRoutes = tryRequireRoute("stockist");
const medicineRoutes = tryRequireRoute("medicine");
const companyRoutes = tryRequireRoute("company");

// Import middleware
const { handleUploadError } = require("./middleware/upload");

const app = express();

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// CORS configuration
const corsOptions = {
  // Allow the production frontend by default (Vercel URL). The FRONTEND_URL
  // environment variable can override this for other deployments.
  origin: [
    process.env.FRONTEND_URL || "https://medi-trap-frontend.vercel.app",
    "http://localhost:5173",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// Robust origin echo middleware: read allowed origins from FRONTEND_URLS
// (comma-separated) or FRONTEND_URL (single). If the incoming request's
// Origin matches an allowed origin, echo it back. This prevents the
// Access-Control-Allow-Origin header from containing a static value that
// doesn't match the browser-supplied Origin.
const rawFrontends =
  process.env.FRONTEND_URLS ||
  process.env.FRONTEND_URL ||
  "https://medi-trap-frontend.vercel.app";
const allowedOrigins = new Set(
  rawFrontends
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// Debug: print allowed origins at startup
console.log("Allowed CORS origins:", Array.from(allowedOrigins));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = !!(origin && allowedOrigins.has(origin));
  // Debug: log incoming origin and whether it's allowed
  console.log(`CORS: incoming Origin=${origin} allowed=${allowed}`);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,OPTIONS"
    );
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use("/api/auth", authRoutes);
// Mount purchaser routes
app.use("/api/purchaser", purchaserRoutes);
// Mount placeholder routes for frontend
app.use("/api/stockist", stockistRoutes);
app.use("/api/medicine", medicineRoutes);
app.use("/api/company", companyRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "MedTrap Backend is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Error handling middleware
app.use(handleUploadError);

app.use((error, req, res, next) => {
  console.error("Global error handler:", error);

  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors: Object.values(error.errors).map((err) => err.message),
    });
  }

  if (error.name === "MongoError" && error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: "Duplicate field value. This value already exists.",
    });
  }

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// MongoDB connection
const connectDB = async () => {
  try {
    // Support multiple common environment variable names for the MongoDB URI.
    // This project historically referenced `MONGO_URI` in code but some
    // env files use `MONGODB_URI` or `DB_URI`. Accept any of them.
    const mongoUri =
      process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;

    if (!mongoUri || typeof mongoUri !== "string") {
      throw new Error(
        "MongoDB connection string not set. Please add MONGO_URI (or MONGODB_URI/DB_URI) to config.env or .env and restart."
      );
    }

    console.log(
      `Using MongoDB URI from ${
        process.env.MONGO_URI
          ? "MONGO_URI"
          : process.env.MONGODB_URI
          ? "MONGODB_URI"
          : "DB_URI"
      }`
    );

    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

startServer();

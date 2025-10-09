const dotenv = require("dotenv");
dotenv.config();
const isDevelopment = process.env.NODE_ENV === "development";
// Load environment variables. Resolve files relative to this file's
// directory first (Backend/), then fall back to the process cwd. This
// avoids issues when nodemon or scripts run from the repository root.
const fs = require("fs");
const path = require("path");

const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");

// Initialize Redis client (config/redisClient will try to connect). Keep require for side-effects.
const redisClient = require("./config/redisClient");

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

// Production sanity checks: fail early if critical environment variables are missing.
// This helps avoid accidental deployments with incomplete configuration.
if (process.env.NODE_ENV === "production") {
  const hasMongo =
    process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;
  const hasJwt = Boolean(
    process.env.JWT_SECRET && String(process.env.JWT_SECRET).trim()
  );
  const hasFrontend = Boolean(
    process.env.FRONTEND_BASE_URL ||
      process.env.FRONTEND_URL ||
      process.env.FRONTEND_URLS
  );

  const missing = [];
  if (!hasMongo) missing.push("MONGO_URI (or MONGODB_URI / DB_URI)");
  if (!hasJwt) missing.push("JWT_SECRET");
  if (!hasFrontend)
    missing.push("FRONTEND_BASE_URL or FRONTEND_URL (recommended)");

  if (missing.length > 0) {
    console.error(
      "Production configuration incomplete. Missing required environment variables:",
      missing.join(", ")
    );
    console.error(
      "Please set the missing variables in the environment and restart the process."
    );
    // Exit with non-zero so orchestrators (systemd, docker, k8s) notice the misconfiguration.
    process.exit(1);
  }
}
const express = require("express");
const helmet = require("helmet");
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

// redis client is created/connected in ./config/redisClient.js

// NOTE: sanitization middleware must be installed after the Express app is created
// and body parsers (express.json / express.urlencoded) are mounted so they can
// inspect req.body / req.query. The actual app.use(...) calls are added further
// down, immediately after the body parsers are configured.

// Import route modules using the resilient helper
const authRoutes = tryRequireRoute("auth");
const purchaserRoutes = tryRequireRoute("Purchaser");
const stockistRoutes = tryRequireRoute("stockist");
const medicineRoutes = tryRequireRoute("medicine");
const companyRoutes = tryRequireRoute("company");
const staffRoutes = tryRequireRoute("staff");
const migrationRoutes = tryRequireRoute("migration");
const purchasingCardRoutes = tryRequireRoute("purchasingCard");
const verifyRoutes = tryRequireRoute("verify");
const userRoutes = tryRequireRoute("user");

// Import middleware
const { handleUploadError } = require("./middleware/upload");

const app = express();

// Middleware
// Security headers
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Install sanitization middleware after body parsers so req.body is available.
try {
  // Instead of calling third-party middlewares which may attempt to assign
  // to `req.query` (causing "getter-only" errors in some environments),
  // run a safe, in-place sanitizer for the common cases we need:
  //  - remove any object keys that start with '$' or contain '.' (Mongo operator injection)
  //  - escape angle brackets in string values to mitigate simple XSS
  // This approach mutates existing objects and never assigns to `req.query` as a whole.

  const removeMongoOperators = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      if (key.startsWith("$") || key.includes(".")) {
        delete obj[key];
        continue;
      }
      const val = obj[key];
      if (val && typeof val === "object") {
        removeMongoOperators(val);
      }
    }
  };

  const escapeStringValues = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === "string") {
        // minimal escaping to avoid injecting HTML into responses
        obj[key] = val.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      } else if (val && typeof val === "object") {
        escapeStringValues(val);
      }
    }
  };

  app.use((req, res, next) => {
    try {
      const hasObjectBody =
        req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body);
      const hasQuery = req.query && typeof req.query === "object";
      const hasParams = req.params && typeof req.params === "object";

      if (!hasObjectBody && !hasQuery && !hasParams) {
        if (process.env.NODE_ENV === "development") {
          console.debug(
            `Sanitizer skipped for ${req.method} ${req.path}: no object body/query/params`
          );
        }
        return next();
      }

      // Sanitize in-place (no reassignment to req.query/req.params)
      if (hasObjectBody) {
        removeMongoOperators(req.body);
        escapeStringValues(req.body);
      }
      if (hasQuery) {
        removeMongoOperators(req.query);
        escapeStringValues(req.query);
      }
      if (hasParams) {
        removeMongoOperators(req.params);
        escapeStringValues(req.params);
      }

      return next();
    } catch (e) {
      console.warn(
        "Sanitization runtime error, skipping sanitizers:",
        e && e.message
      );
      return next();
    }
  });

  console.log("Sanitization: guarded in-place cleaners enabled");
} catch (e) {
  console.warn("Sanitization middleware failed to initialize:", e && e.message);
}

// CORS configuration
const corsOptions = {
  // Allow the production frontend by default (Vercel URL). The FRONTEND_URL
  // environment variable can override this for other deployments.
  origin: [
    process.env.FRONTEND_BASE_URL ||
      process.env.FRONTEND_URL ||
      "https://medi-trap-frontend.vercel.app",
    "http://localhost:5173",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Note: dynamic CORS middleware will be applied after the allowedOrigins
// set is created below so it can use the runtime allowlist. The static
// cors(corsOptions) call is intentionally omitted here.
// app.use(cors(corsOptions));

// Robust origin echo middleware: read allowed origins from FRONTEND_URLS
// (comma-separated) or FRONTEND_URL (single). We always include the Vercel
// frontend origin as a sensible default so deployed frontends can access the
// API even when the Render environment wasn't updated. Any values in
// FRONTEND_URLS or FRONTEND_URL will be merged with this default.
const DEFAULT_FRONTEND =
  process.env.FRONTEND_BASE_URL ||
  process.env.FRONTEND_URL ||
  "https://medi-trap-frontend.vercel.app";
// Include common local dev origins so Vite (localhost:5173) can talk to the API during development.
const DEV_FRONTENDS = ["http://localhost:5173", "http://10.0.2.2:5000"];
const rawFrontends =
  process.env.FRONTEND_URLS ||
  process.env.FRONTEND_URL ||
  process.env.FRONTEND_BASE_URL ||
  DEFAULT_FRONTEND;
const allowedOrigins = new Set(
  // Start from the default, include common dev origins, and merge any environment-provided origins.
  [DEFAULT_FRONTEND]
    .concat(DEV_FRONTENDS)
    .concat(
      String(rawFrontends)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
    // Normalize and dedupe
    .map((s) => s.replace(/\/+$/, ""))
);

// Ensure common frontend origin is always present (helps deployments where env vars
// were not set correctly). This is safe because it's the known production frontend.
try {
  allowedOrigins.add("https://medi-trap-frontend.vercel.app");
} catch (e) {}

// Expose the current allowlist to runtime (debugging). Do not leak secrets.
global.__ALLOWED_ORIGINS__ = Array.from(allowedOrigins);

// Dynamic CORS middleware: reflect the incoming Origin when allowed.
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (curl, server-to-server) with no Origin
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      // During development, allow common local-LAN origins (phone testing)
      if (isDevelopment) {
        try {
          // Accept origins like http://192.168.x.y(:port) or http://10.x.x.x(:port)
          const localLanRegex =
            /^https?:\/\/(?:192\.168|10|172\.(1[6-9]|2\d|3[0-1]))(?:\.\d{1,3}){2}(?::\d+)?$/;
          if (localLanRegex.test(origin)) return callback(null, true);
        } catch (e) {
          // ignore and fallthrough to reject
        }
      }
      // Not allowed: do not throw an error (that bubbles to the global error
      // handler). Instead, respond with success=false so CORS middleware will
      // not set the CORS headers and the browser will block the request.
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Debug: print allowed origins at startup
console.log("Allowed CORS origins:", Array.from(allowedOrigins));

// Mount debug route (temporary) to inspect runtime env and allowedOrigins
try {
  const debugRouter = require("./routes/debug");
  app.use("/debug", debugRouter);
} catch (e) {
  console.warn("Debug route not mounted:", e && e.message);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  let allowed = false;
  if (!origin) {
    // Allow requests with no Origin header (static files, images)
    allowed = true;
  } else if (allowedOrigins.has(origin)) {
    allowed = true;
  } else if (isDevelopment) {
    // Mirror the same local LAN allowlist as the CORS handler above
    try {
      const localLanRegex =
        /^https?:\/\/(?:192\.168|10|172\.(1[6-9]|2\d|3[0-1]))(?:\.\d{1,3}){2}(?::\d+)?$/;
      if (localLanRegex.test(origin)) allowed = true;
    } catch (e) {
      // ignore
    }
  }
  // Debug: log incoming origin and whether it's allowed
  console.log(`CORS: incoming Origin=${origin} allowed=${allowed}`);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
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

// Prevent caching for API responses (development & production safe):
// This avoids conditional GET/ETag 304 responses returning stale cached
// resource bodies in the browser after a login/token swap.
app.use((req, res, next) => {
  try {
    if (req.path && req.path.startsWith("/api/")) {
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  } catch (e) {
    // ignore header errors
  }
  next();
});

// Serve uploaded files (images) so frontend can load them by URL
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Dev-only: log Authorization header snippet for API requests to help debug
app.use((req, res, next) => {
  try {
    if (req.path && req.path.startsWith("/api/")) {
      const auth = req.headers.authorization || "(none)";
      const snippet =
        typeof auth === "string" && auth.startsWith("Bearer ")
          ? auth.slice(7, 19) + "..."
          : auth;
      console.debug(
        `ReqAuth: ${req.method} ${req.path} -> Authorization=${snippet}`
      );
    }
  } catch (e) {
    // ignore logging errors
  }
  next();
});

// RPS metrics middleware (counts requests per second)
try {
  const { rpsMiddleware, rpsMonitor } = require("./middleware/rps");
  app.use(rpsMiddleware);

  // Expose a simple metrics endpoint to fetch RPS
  app.get("/metrics/rps", (req, res) => {
    res.json({
      success: true,
      lastSecond: rpsMonitor.getLastSecond(),
      history: rpsMonitor.getHistory(),
      averagePerSecond: rpsMonitor.getAverage(),
      windowSeconds: rpsMonitor.windowSize,
      timestamp: Date.now(),
    });
  });
} catch (e) {
  console.warn("RPS middleware not available:", e && e.message);
}

// Routes
app.use("/api/auth", authRoutes);
// Mount purchaser routes
app.use("/api/purchaser", purchaserRoutes);
// Mount purchasing card request/grant endpoints
app.use("/api/purchasing-card", purchasingCardRoutes);
// Mount placeholder routes for frontend
app.use("/api/stockist", stockistRoutes);
app.use("/api/medicine", medicineRoutes);
app.use("/api/company", companyRoutes);
// Mount staff routes
app.use("/api/staff", staffRoutes);
// Mount migration routes (dry-run backfill)
app.use("/api/migration", migrationRoutes);
// Mount purchasing-card endpoints
app.use("/api/purchasing-card", purchasingCardRoutes);
// Document verification endpoints (OCR, checks)
app.use("/api/verify", verifyRoutes);
// User routes (admin user management)
app.use("/api/user", userRoutes);

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

// 404 handler (must be last, and avoid wildcard string)
app.use((req, res) => {
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
  console.error(
    "Unhandled Promise Rejection:",
    err && err.stack ? err.stack : err
  );
  // Do not exit immediately in development to allow debugging. In production
  // you might want to exit and restart the process.
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err && err.stack ? err.stack : err);
  // Do not exit immediately in development so we can inspect logs. Consider
  // restarting the process in production.
});

startServer();

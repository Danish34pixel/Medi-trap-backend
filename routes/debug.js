const express = require("express");
const router = express.Router();
const path = require("path");
const prodMailer = require(path.join(
  __dirname,
  "..",
  "utils",
  "prodMailerHelper"
));
const { authenticate } = require("../middleware/auth");

function redact(val) {
  if (!val) return null;
  return String(val).length > 6 ? String(val).slice(0, 3) + "***" : "***";
}

// Dev-only: return basic info about the authenticated user/token
router.get("/me", authenticate, (req, res) => {
  try {
    const user = req.user || null;
    const safe = user
      ? {
          id: user._id || user.id || null,
          role: user.role || null,
          email: user.email || user.contactNo || null,
        }
      : null;
    res.json({ success: true, data: safe });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get("/info", (req, res) => {
  try {
    const allowed = global.__ALLOWED_ORIGINS__ || [];
    res.json({
      success: true,
      allowedOrigins: allowed,
      env: {
        NODE_ENV: process.env.NODE_ENV || null,
        FRONTEND_URL: process.env.FRONTEND_URL
          ? redact(process.env.FRONTEND_URL)
          : null,
        FRONTEND_URLS: process.env.FRONTEND_URLS
          ? redact(process.env.FRONTEND_URLS)
          : null,
        MONGO_URI_PRESENT: !!(
          process.env.MONGO_URI ||
          process.env.MONGODB_URI ||
          process.env.DB_URI
        ),
        SENDGRID: !!(process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY),
        EMAIL_USER: !!process.env.EMAIL_USER,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "debug error" });
  }
});

// Protected endpoint to run an SMTP check from the running process.
// Accepts POST { to: "recipient@example.com" } and requires header
// `x-debug-token` to equal process.env.DEBUG_TOKEN. This avoids exposing
// an unauthenticated send endpoint in public deployments.
router.post("/email-check", async (req, res) => {
  try {
    const token = req.headers["x-debug-token"] || "";
    if (!process.env.DEBUG_TOKEN) {
      return res.status(403).json({
        success: false,
        message:
          "Email check endpoint disabled on this deployment (no DEBUG_TOKEN set).",
      });
    }
    if (!token || token !== process.env.DEBUG_TOKEN) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid debug token" });
    }

    const to = req.body && req.body.to ? String(req.body.to).trim() : null;
    if (!to)
      return res
        .status(400)
        .json({ success: false, message: "Missing 'to' in body" });

    const result = await prodMailer.sendTestMail({
      to,
      subject: "Prod SMTP check",
      text: "This is a production SMTP diagnostic message.",
    });
    return res.json({ success: true, result });
  } catch (err) {
    console.error("/debug/email-check error:", err);
    return res.status(500).json({
      success: false,
      message: "Email check failed",
      error: err && err.message,
    });
  }
});

// Protected helper to fetch image headers and a small range from Cloudinary to diagnose
// network/TLS issues. Restricted to Cloudinary domains to avoid open proxy.
router.post("/fetch-image", async (req, res) => {
  try {
    const token = req.headers["x-debug-token"] || "";
    if (!process.env.DEBUG_TOKEN) {
      return res.status(403).json({
        success: false,
        message: "Image fetch disabled (no DEBUG_TOKEN set).",
      });
    }
    if (!token || token !== process.env.DEBUG_TOKEN) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid debug token" });
    }

    const { url } = req.body || {};
    if (!url || typeof url !== "string")
      return res
        .status(400)
        .json({ success: false, message: "Missing 'url' in body" });

    // Allow only Cloudinary hosts
    const allowedHostPattern = /https:\/\/(?:[a-z0-9\-]+\.)*cloudinary\.com\//i;
    if (!allowedHostPattern.test(url)) {
      return res
        .status(400)
        .json({ success: false, message: "Only Cloudinary URLs are allowed" });
    }

    const doFetch = async (method, extraHeaders = {}) => {
      if (typeof fetch === "function") {
        const resp = await fetch(url, { method, headers: extraHeaders });
        const headers = {};
        resp.headers.forEach((v, k) => (headers[k] = v));
        const body =
          method === "GET" ? await resp.arrayBuffer().catch(() => null) : null;
        return {
          status: resp.status,
          ok: resp.ok,
          headers,
          bodyLength: body ? body.byteLength : null,
        };
      }
      const https = require("https");
      return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const opts = {
          method,
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          headers: extraHeaders,
        };
        const req = https.request(opts, (r) => {
          const headers = r.headers || {};
          let length = 0;
          if (method === "GET") {
            r.on("data", (chunk) => {
              length += chunk.length;
              if (length > 16 * 1024) req.destroy();
            });
          }
          r.on("end", () =>
            resolve({
              status: r.statusCode,
              ok: r.statusCode >= 200 && r.statusCode < 400,
              headers,
              bodyLength: length,
            })
          );
          r.on("error", (e) => reject(e));
        });
        req.on("error", (e) => reject(e));
        req.end();
      });
    };

    let headResult = null;
    try {
      headResult = await doFetch("HEAD");
    } catch (headErr) {
      headResult = { error: headErr && headErr.message };
    }

    let getResult = null;
    try {
      getResult = await doFetch("GET", { Range: "bytes=0-16383" });
    } catch (getErr) {
      getResult = { error: getErr && getErr.message };
    }

    return res.json({ success: true, url, head: headResult, get: getResult });
  } catch (err) {
    console.error("/debug/fetch-image error:", err);
    return res.status(500).json({
      success: false,
      message: "fetch-image failed",
      error: err && err.message,
    });
  }
});

module.exports = router;

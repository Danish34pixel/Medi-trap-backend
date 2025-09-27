const nodemailer = require("nodemailer");

// Build a transporter. If SMTP config is not provided or USE_ETHEREAL=true,
// create an Ethereal test account and use it (useful for local/dev testing).
async function createTransporter() {
  // Allow either EMAIL_* or SMTP_* env names. Many setups use SMTP_USER/PASS.
  const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
  const emailPass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
  const emailHost = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const emailPort = process.env.EMAIL_PORT || process.env.SMTP_PORT;
  const emailSecure = process.env.EMAIL_SECURE || process.env.SMTP_SECURE;

  const useEthereal = process.env.USE_ETHEREAL === "true" || !emailUser;
  const isProduction = process.env.NODE_ENV === "production";

  // In production we must not fall back to Ethereal; require credentials
  if (isProduction && !emailUser) {
    throw new Error(
      "Mailer: SMTP credentials missing in production (EMAIL_USER or SMTP_USER)"
    );
  }

  if (useEthereal) {
    const testAccount = await nodemailer.createTestAccount();
    return {
      transporter: nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: { user: testAccount.user, pass: testAccount.pass },
      }),
      preview: true,
    };
  }

  const host = emailHost || "smtp.gmail.com";
  const port = emailPort ? Number(emailPort) : 587;
  const secure = emailSecure === "true" || false;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });

  return { transporter, preview: false };
}

// sendMail returns { info, previewUrl } where previewUrl exists when using Ethereal
// Accepts optional `from` so callers can override the sender address when needed.
async function sendMail({ to, subject, html, text, from }) {
  // Try SMTP transport first; in development, if SMTP fails, fall back to Ethereal
  let primary = null;
  let preview = false;
  try {
    primary = await createTransporter();
    const { transporter } = primary;
    const effectiveFrom =
      from ||
      process.env.EMAIL_FROM ||
      process.env.EMAIL_USER ||
      "ak9084232@gmail.com";
    if (process.env.NODE_ENV === "development")
      console.log("sendMail: sending from=", effectiveFrom, "to=", to);
    const info = await transporter.sendMail({
      from: effectiveFrom,
      to,
      subject,
      text,
      html,
    });
    let previewUrl = null;
    if (primary.preview)
      previewUrl = nodemailer.getTestMessageUrl(info) || null;
    return { info, previewUrl };
  } catch (smtpErr) {
    console.error(
      "sendMail: primary transport failed",
      smtpErr && smtpErr.message
    );
    // In development, automatically fall back to Ethereal so developers can
    // still test email flows even when SMTP creds are not present or fail.
    if (process.env.NODE_ENV === "development") {
      try {
        const testAccount = await nodemailer.createTestAccount();
        const fallbackTransporter = nodemailer.createTransport({
          host: testAccount.smtp.host,
          port: testAccount.smtp.port,
          secure: testAccount.smtp.secure,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
        const effectiveFrom =
          from ||
          process.env.EMAIL_FROM ||
          testAccount.user ||
          "no-reply@example.com";
        if (process.env.NODE_ENV === "development")
          console.log(
            "sendMail: ethereal fallback from=",
            effectiveFrom,
            "to=",
            to
          );
        const info = await fallbackTransporter.sendMail({
          from: effectiveFrom,
          to,
          subject,
          text,
          html,
        });
        const previewUrl = nodemailer.getTestMessageUrl(info) || null;
        console.log("Ethereal preview URL:", previewUrl);
        return { info, previewUrl };
      } catch (ethErr) {
        console.error(
          "sendMail: Ethereal fallback also failed",
          ethErr && ethErr.message
        );
        throw ethErr;
      }
    }
    throw smtpErr;
  }
}

module.exports = { sendMail };

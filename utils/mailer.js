
const nodemailer = require('nodemailer');

// Build a transporter. If SMTP config is not provided or USE_ETHEREAL=true,
// create an Ethereal test account and use it (useful for local/dev testing).
async function createTransporter() {
  const useEthereal = process.env.USE_ETHEREAL === 'true' || !process.env.EMAIL_USER;

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

  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587;
  const secure = process.env.EMAIL_SECURE === 'true';

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  return { transporter, preview: false };
}

// sendMail returns { info, previewUrl } where previewUrl exists when using Ethereal
async function sendMail({ to, subject, html, text }) {
  const { transporter, preview } = await createTransporter();
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@example.com';

  const info = await transporter.sendMail({ from, to, subject, text, html });

  let previewUrl = null;
  if (preview) previewUrl = nodemailer.getTestMessageUrl(info) || null;

  return { info, previewUrl };
}

module.exports = { sendMail };

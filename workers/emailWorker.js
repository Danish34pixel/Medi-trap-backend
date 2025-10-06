const { Worker } = require("bullmq");
const { connection } = require("../queues/emailQueue");
const { sendMail } = require("../utils/mailer");

const worker = new Worker(
  "emailQueue",
  async (job) => {
    const { to, subject, html, text, from } = job.data;
    try {
      const result = await sendMail({ to, subject, html, text, from });
      if (result && result.previewUrl) {
        console.log("Email preview URL:", result.previewUrl);
      }
      return { ok: true };
    } catch (err) {
      console.error("emailWorker: failed to send", err && err.message);
      // rethrow to allow BullMQ to handle retries based on job.opts
      throw err;
    }
  },
  { connection, concurrency: Number(process.env.EMAIL_WORKER_CONCURRENCY) || 5 }
);

worker.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed:`, err && err.message);
});

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

console.log("Email worker started (emailQueue)");

// allow requiring this file to keep the process alive if executed directly
module.exports = worker;

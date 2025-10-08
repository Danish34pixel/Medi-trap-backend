const { Queue } = require("bullmq");
const IORedis = require("ioredis");

// Redis connection - configurable via env
let connection;
if (process.env.REDIS_URL) {
  connection = new IORedis(process.env.REDIS_URL);
} else {
  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379;
  const username = process.env.REDIS_USERNAME || undefined;
  const password = process.env.REDIS_PASSWORD || undefined;
  const useTls =
    String(process.env.REDIS_TLS || "false").toLowerCase() === "true";

  const opts = {
    host,
    port,
    username,
    password,
  };
  if (useTls) opts.tls = {};
  connection = new IORedis(opts);
}

const emailQueue = new Queue("emailQueue", { connection });

module.exports = { emailQueue, connection };

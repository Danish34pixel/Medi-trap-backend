const redisClient = require("../config/redisClient");

// In-memory fallback cache with TTL support
const fallbackStore = new Map();

function setFallback(key, value, ttlSeconds) {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  fallbackStore.set(key, { value, expiresAt });
  if (ttlSeconds) {
    setTimeout(() => {
      const item = fallbackStore.get(key);
      if (!item) return;
      if (item.expiresAt && Date.now() >= item.expiresAt)
        fallbackStore.delete(key);
    }, Math.min(1000 * 60 * 60, ttlSeconds * 1000));
  }
}

function getFallback(key) {
  const item = fallbackStore.get(key);
  if (!item) return null;
  if (item.expiresAt && Date.now() >= item.expiresAt) {
    fallbackStore.delete(key);
    return null;
  }
  return item.value;
}

module.exports = {
  async getJson(key) {
    try {
      if (redisClient) {
        const val = await redisClient.get(key);
        return val ? JSON.parse(val) : null;
      }
    } catch (e) {
      console.warn("cache.getJson error (redis):", e && e.message);
    }
    try {
      return getFallback(key);
    } catch (e) {
      return null;
    }
  },

  async setJson(key, obj, ttlSeconds) {
    try {
      const str = JSON.stringify(obj);
      if (redisClient) {
        if (ttlSeconds && Number(ttlSeconds) > 0) {
          await redisClient.set(key, str, "EX", Number(ttlSeconds));
        } else {
          await redisClient.set(key, str);
        }
        return true;
      }
    } catch (e) {
      console.warn("cache.setJson error (redis):", e && e.message);
    }
    try {
      setFallback(key, obj, ttlSeconds);
      return true;
    } catch (e) {
      return false;
    }
  },

  async del(key) {
    try {
      if (redisClient) {
        await redisClient.del(key);
        return true;
      }
    } catch (e) {
      console.warn("cache.del error (redis):", e && e.message);
    }
    try {
      fallbackStore.delete(key);
      return true;
    } catch (e) {
      return false;
    }
  },
};

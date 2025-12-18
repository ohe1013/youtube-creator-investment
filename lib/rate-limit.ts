interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export function rateLimit(config: RateLimitConfig) {
  return {
    check: (identifier: string): { success: boolean; remaining: number } => {
      const now = Date.now();
      const record = store[identifier];

      // Clean up expired records
      if (record && now > record.resetTime) {
        delete store[identifier];
      }

      // Initialize or get current record
      const current = store[identifier] || {
        count: 0,
        resetTime: now + config.windowMs,
      };

      // Check limit
      if (current.count >= config.maxRequests) {
        return {
          success: false,
          remaining: 0,
        };
      }

      // Increment count
      current.count++;
      store[identifier] = current;

      return {
        success: true,
        remaining: config.maxRequests - current.count,
      };
    },
  };
}

// Pre-configured limiters
export const tradeLimiter = rateLimit({
  maxRequests: 10,
  windowMs: 1000, // 1 second
});

export const apiLimiter = rateLimit({
  maxRequests: 100,
  windowMs: 60000, // 1 minute
});

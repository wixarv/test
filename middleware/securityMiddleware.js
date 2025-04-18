const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const hpp = require("hpp");

// Rate limiters for signup and login
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: { success: false, message: "Too many requests, please try again later" },
  keyGenerator: (req) => req.ip + req.headers["user-agent"],
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per window
  message: { success: false, message: "Too many login attempts, please try again later" },
  keyGenerator: (req) => req.ip,
});

const applySecurity = (app) => {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      hidePoweredBy: true,
      noSniff: true,
    })
  );

  app.use(mongoSanitize());
  app.use(xss());
  app.use(hpp({ whitelist: ["lang"] }));

  // Rate limiting will be applied directly in the routes, not globally
};

module.exports = applySecurity;
module.exports.authLimiter = authLimiter; // Export for signup
module.exports.loginLimiter = loginLimiter; // Export for login
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const hpp = require("hpp");

const applySecurity = (app) => {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { success: false, message: "Too many requests, please try again later" },
  });

  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    })
  );

  app.use(hpp());
  app.use(mongoSanitize());
  app.use(xss());
  // app.use("/auth", authLimiter);
  app.use(generalLimiter);
};

module.exports = applySecurity;
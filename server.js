require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const providerRoutes = require("./routes/providers");
const requestRoutes = require("./routes/requests");
const webhookRoutes = require("./routes/webhooks");
const adminRoutes = require("./routes/admin");

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN, // set this to your real website address, e.g. https://your-site.netlify.app
  })
);

// Webhooks MUST be mounted with express.raw() and BEFORE express.json(),
// or Stripe's signature check will fail against an already-parsed body.
app.use("/webhooks", express.raw({ type: "application/json" }), webhookRoutes);

app.use(express.json({ limit: "1mb" }));

// Global rate limit as a floor; auth routes have their own tighter limit.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use("/auth", authRoutes);
app.use("/providers", providerRoutes);
app.use("/requests", requestRoutes);
app.use("/admin", adminRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

// Centralized error handler — never leak stack traces to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`ServConnect API listening on :${port}`));

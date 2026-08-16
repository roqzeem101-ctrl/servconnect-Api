const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { query } = require("../db");

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// Slow down credential stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["customer", "provider"]),
  displayName: z.string().min(1).optional(),
});

function issueTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_TTL || "15m" }
  );
  const refreshToken = jwt.sign(
    { sub: user.id, tokenType: "refresh" },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_TTL || "30d" }
  );
  return { accessToken, refreshToken };
}

router.post("/signup", authLimiter, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, role, displayName } = parsed.data;

  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    // Generic message — don't confirm which emails are registered.
    return res.status(400).json({ error: "Could not create account" });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role`,
    [email, passwordHash, role]
  );
  const user = rows[0];

  if (role === "provider") {
    await query(
      `INSERT INTO provider_profiles (user_id, display_name, verification_status)
       VALUES ($1, $2, 'pending')`,
      [user.id, displayName || email.split("@")[0]]
    );
  }

  const tokens = issueTokens(user);
  res.status(201).json({ user, ...tokens });
});

router.post("/login", authLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid credentials" });

  const { email, password } = parsed.data;
  const { rows } = await query(
    "SELECT id, email, role, password_hash FROM users WHERE email = $1",
    [email]
  );
  // Constant-shape response whether the email exists or not, to avoid
  // leaking valid emails via response timing/content.
  const user = rows[0];
  const hashToCompare = user ? user.password_hash : "$2b$12$invalidsaltinvalidsaltinvalidsaltu";
  const valid = await bcrypt.compare(password, hashToCompare);

  if (!user || !valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const tokens = issueTokens(user);
  res.json({ user: { id: user.id, email: user.email, role: user.role }, ...tokens });
});

router.post("/refresh", authLimiter, async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: "Missing refresh token" });

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const { rows } = await query("SELECT id, role FROM users WHERE id = $1", [payload.sub]);
    if (rows.length === 0) return res.status(401).json({ error: "Invalid token" });

    const accessToken = jwt.sign(
      { sub: rows[0].id, role: rows[0].role },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: process.env.JWT_ACCESS_TTL || "15m" }
    );
    res.json({ accessToken });
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

module.exports = router;

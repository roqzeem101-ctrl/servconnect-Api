const express = require("express");
const { z } = require("zod");
const { query, withTransaction } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { requireRequestAccess } = require("../middleware/authorize");
const { createAuthorization } = require("../payments/stripe");

const router = express.Router();

// Server-enforced state machine — the client can never PATCH a request
// straight to an arbitrary status. Each key lists the statuses it's
// legal to move to, and which role is allowed to make that move.
const TRANSITIONS = {
  pending: { accepted: "provider", declined: "provider", cancelled: "customer" },
  accepted: { in_progress: "provider", cancelled: "customer" },
  in_progress: { completed: "provider", disputed: "customer" },
  completed: { disputed: "customer" },
};

async function logAudit(actorId, action, entityId, detail) {
  await query(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, 'request', $3, $4)`,
    [actorId, action, entityId, detail ? JSON.stringify(detail) : null]
  );
}

const createSchema = z.object({
  providerId: z.string().uuid(),
  categoryId: z.string().uuid(),
  customerLat: z.number(),
  customerLng: z.number(),
  customerAddress: z.string().min(3),
  quotedPrice: z.number().positive(),
  scheduledTime: z.string().datetime().optional(),
});

// POST /requests — customer creates a request; payment method authorized, not captured yet.
router.post("/", requireAuth, requireRole("customer"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO requests
         (customer_id, provider_id, category_id, customer_lat, customer_lng,
          customer_address, quoted_price, scheduled_time, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING id, status, requested_at`,
      [req.user.id, d.providerId, d.categoryId, d.customerLat, d.customerLng,
       d.customerAddress, d.quotedPrice, d.scheduledTime || null]
    );
    const request = rows[0];

    // Authorize (don't capture) the payment now — captured only on accept.
    const paymentIntent = await createAuthorization({
      amountUsd: d.quotedPrice,
      requestId: request.id,
    });
    await client.query(
      `INSERT INTO payments (request_id, stripe_payment_intent_id, amount, platform_fee, status)
       VALUES ($1,$2,$3,$4,'authorized')`,
      [request.id, paymentIntent.id, d.quotedPrice, d.quotedPrice * (process.env.PLATFORM_FEE_PERCENT / 100)]
    );

    return request;
  });

  await logAudit(req.user.id, "request_created", result.id);
  res.status(201).json({ request: result });
});

// GET /requests/:id — ownership-scoped; address only included if accepted+.
router.get("/:id", requireAuth, requireRequestAccess(), async (req, res) => {
  const r = req.requestRecord;
  const revealAddress = ["accepted", "in_progress", "completed"].includes(r.status);
  res.json({
    request: {
      ...r,
      customer_address: revealAddress ? r.customer_address : undefined,
    },
  });
});

// GET /requests?status=&role=customer|provider — list mine, scoped server-side.
router.get("/", requireAuth, async (req, res) => {
  const column = req.user.role === "provider" ? "provider_id" : "customer_id";
  const params = [req.user.id];
  let statusFilter = "";
  if (req.query.status) {
    params.push(req.query.status);
    statusFilter = `AND status = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT * FROM requests WHERE ${column} = $1 ${statusFilter} ORDER BY requested_at DESC`,
    params
  );
  const revealed = rows.map((r) => ({
    ...r,
    customer_address: ["accepted", "in_progress", "completed"].includes(r.status)
      ? r.customer_address
      : undefined,
  }));
  res.json({ requests: revealed });
});

const transitionSchema = z.object({ status: z.string() });

// PATCH /requests/:id/status — the only way to change status; validated against TRANSITIONS.
router.patch("/:id/status", requireAuth, requireRequestAccess(), async (req, res) => {
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Missing status" });

  const current = req.requestRecord.status;
  const target = parsed.data.status;
  const allowed = TRANSITIONS[current] || {};

  if (!allowed[target]) {
    return res.status(409).json({ error: `Cannot move request from '${current}' to '${target}'` });
  }
  if (allowed[target] !== req.user.role) {
    return res.status(403).json({ error: `Only the ${allowed[target]} can make this transition` });
  }

  await query(
    `UPDATE requests SET status = $1, updated_at = now() WHERE id = $2`,
    [target, req.params.id]
  );

  // Capture payment on accept; release on completion (see payments/stripe.js).
  const { capturePayment, releasePayment } = require("../payments/stripe");
  if (target === "accepted") await capturePayment(req.params.id);
  if (target === "completed") await releasePayment(req.params.id);

  await logAudit(req.user.id, `status_${target}`, req.params.id, { from: current, to: target });

  res.json({ status: target });
});

module.exports = router;

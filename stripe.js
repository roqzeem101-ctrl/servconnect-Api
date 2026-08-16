const Stripe = require("stripe");
const { query } = require("../db");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 15);

/**
 * Step 1 — authorize only. Card is validated and funds are reserved,
 * but not charged, until the provider accepts. Uses manual capture so
 * nothing moves until we explicitly capture it.
 */
async function createAuthorization({ amountUsd, requestId }) {
  return stripe.paymentIntents.create({
    amount: Math.round(amountUsd * 100), // cents
    currency: "usd",
    capture_method: "manual",
    metadata: { requestId },
  });
}

/**
 * Step 2 — provider accepts: capture the authorized charge. Funds now
 * sit in the platform's Stripe balance (escrow), not yet paid to the provider.
 */
async function capturePayment(requestId) {
  const { rows } = await query(
    `SELECT stripe_payment_intent_id FROM payments WHERE request_id = $1`,
    [requestId]
  );
  if (rows.length === 0) throw new Error("No payment found for request");

  await stripe.paymentIntents.capture(rows[0].stripe_payment_intent_id);
  await query(`UPDATE payments SET status = 'held' WHERE request_id = $1`, [requestId]);
}

/**
 * Step 3 — job completed: transfer the provider's share (amount minus
 * platform fee) to their connected Stripe account. In production this
 * should run after a dispute hold window, not immediately — kept
 * synchronous here for clarity; wire it to a delayed job queue instead.
 */
async function releasePayment(requestId) {
  const { rows: paymentRows } = await query(
    `SELECT id, amount, platform_fee FROM payments WHERE request_id = $1`,
    [requestId]
  );
  if (paymentRows.length === 0) throw new Error("No payment found for request");
  const payment = paymentRows[0];

  const { rows: reqRows } = await query(
    `SELECT provider_id FROM requests WHERE id = $1`,
    [requestId]
  );
  const { rows: providerRows } = await query(
    `SELECT stripe_account_id FROM provider_profiles WHERE user_id = $1`,
    [reqRows[0].provider_id]
  );
  const stripeAccountId = providerRows[0]?.stripe_account_id;
  if (!stripeAccountId) throw new Error("Provider has no connected payout account");

  const payoutAmount = Number(payment.amount) - Number(payment.platform_fee);

  await stripe.transfers.create({
    amount: Math.round(payoutAmount * 100),
    currency: "usd",
    destination: stripeAccountId,
    metadata: { requestId },
  });

  await query(
    `UPDATE payments SET status = 'released', provider_payout_status = 'paid', processed_at = now()
     WHERE id = $1`,
    [payment.id]
  );
}

async function refundPayment(requestId) {
  const { rows } = await query(
    `SELECT stripe_payment_intent_id FROM payments WHERE request_id = $1`,
    [requestId]
  );
  if (rows.length === 0) return;
  await stripe.refunds.create({ payment_intent: rows[0].stripe_payment_intent_id });
  await query(`UPDATE payments SET status = 'refunded' WHERE request_id = $1`, [requestId]);
}

/**
 * Webhook handler — ALWAYS verify the signature before trusting the
 * payload. Without this, anyone can POST a fake "payment succeeded"
 * event to your endpoint.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signatureHeader,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = {
  createAuthorization,
  capturePayment,
  releasePayment,
  refundPayment,
  verifyWebhookSignature,
};

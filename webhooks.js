const express = require("express");
const { verifyWebhookSignature } = require("../payments/stripe");
const { query } = require("../db");

const router = express.Router();

// Mounted with express.raw() in server.js — signature verification
// requires the exact raw bytes Stripe signed, not a parsed JSON body.
router.post("/stripe", async (req, res) => {
  const signature = req.headers["stripe-signature"];
  let event;
  try {
    event = verifyWebhookSignature(req.body, signature);
  } catch (err) {
    // Reject anything that doesn't verify — this is what stops a
    // spoofed "payment confirmed" call from an attacker.
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  switch (event.type) {
    case "payment_intent.payment_failed": {
      const requestId = event.data.object.metadata?.requestId;
      if (requestId) {
        await query(`UPDATE requests SET status = 'cancelled' WHERE id = $1`, [requestId]);
      }
      break;
    }
    case "account.updated": {
      // Provider's Connect onboarding/KYC status changed.
      const account = event.data.object;
      if (account.charges_enabled) {
        await query(
          `UPDATE provider_profiles SET verification_status = 'verified' WHERE stripe_account_id = $1`,
          [account.id]
        );
      }
      break;
    }
    default:
      break; // ignore events we don't act on
  }

  res.json({ received: true });
});

module.exports = router;

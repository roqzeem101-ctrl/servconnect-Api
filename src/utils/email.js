// Sends transactional email via Resend (resend.com).
// Note: on a brand-new free Resend account, emails can only be delivered
// to the email address you signed up with, until you verify you own a
// real domain in the Resend dashboard. That's a Resend account setting,
// not a bug here -- see the deploy guide for the upgrade path.

async function sendEmail({ to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "ServConnect <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Email send failed: ${res.status} ${detail}`);
  }
  return res.json();
}

function verificationEmailHtml({ name, verifyUrl }) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Welcome to ServConnect, ${name}!</h2>
      <p>Please confirm this is your email address by clicking the link below.</p>
      <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 20px;background:#E8A33D;color:#0E1512;text-decoration:none;border-radius:8px;font-weight:600;">Verify my email</a></p>
      <p style="color:#888;font-size:12px;">This link expires in 24 hours. If you didn't sign up for ServConnect, you can ignore this email.</p>
    </div>
  `;
}

module.exports = { sendEmail, verificationEmailHtml };

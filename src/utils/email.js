import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

console.log("EMAIL util loaded — RESEND_API_KEY:", !!process.env.RESEND_API_KEY);

/**
 * sendEmailOTP: send a plain text OTP email
 */
export async function sendEmailOTP(to, otp) {
  console.log("📨 Attempting to send OTP to:", to);

  try {
    const response = await resend.emails.send({
      from: "onboarding@resend.dev",
      to,
      subject: "Your verification OTP",
      text: `Your verification OTP is ${otp}. It will expire in 10 minutes.`,
    });

    console.log("✅ OTP sent successfully:", response);
    return response;
  } catch (error) {
    console.error("❌ OTP FAILED:", error);
    throw error;  // IMPORTANT
  }
}


/**
 * sendPasswordResetEmail
 */
export async function sendPasswordResetEmail(to, resetUrl) {
  try {
    const response = await resend.emails.send({
      from: "onboarding@resend.dev",
      to,
      subject: "Reset your password",
      html: `
        <p>You requested a password reset.</p>
        <p>Click the link below to reset your password:</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you did not request this, simply ignore this email.</p>
      `,
    });

    return response;
  } catch (error) {
    console.error("Password reset email failed:", error);
    throw error;
  }
}

import { Resend } from 'resend';

export async function sendInviteEmail(to: string, projectName: string) {
  const key = process.env.RESEND_API_KEY;
  const site = process.env.NEXT_PUBLIC_SITE_URL!;
  if (!key) return; // email is best-effort; never block the invite
  const resend = new Resend(key);
  await resend.emails.send({
    from: 'Convoy <onboarding@resend.dev>',
    to,
    subject: `You've been added to ${projectName} on Convoy`,
    html: `<p>You've been added to <b>${projectName}</b> on Convoy.</p>
           <p>Sign in with this email: <a href="${site}/login">${site}/login</a></p>
           <p>Then open the project and run the one-line connect command shown there.</p>`,
  });
}

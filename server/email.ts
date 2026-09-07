import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT) || 1025,
  secure: false,
});

export async function sendVerificationEmail(to: string, subject: string, url: string) {
  await transporter.sendMail({
    from: '"FlowSketch" <noreply@flowsketch.local>',
    to,
    subject,
    html: `<p>Click <a href="${url}">here</a> to ${subject.toLowerCase()}.</p>`,
  });
}

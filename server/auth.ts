import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './db.js';
import { sendVerificationEmail } from './email.js';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await sendVerificationEmail(user.email, 'Reset your password', url);
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, 'Verify your email', url);
    },
  },
  trustedOrigins: [
    process.env.BETTER_AUTH_URL || 'http://localhost:5199',
    'https://whimsical.vedalogy.com',
    // The Vite dev server origin, so local sign-in works regardless of what
    // BETTER_AUTH_URL points at (it is often the public tunnel URL).
    ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5199', 'http://127.0.0.1:5199']),
  ],
});

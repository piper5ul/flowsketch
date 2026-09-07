import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './db.js';
import { sendVerificationEmail } from './email.js';
import { publicOrigins } from './origins.js';

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
  // BETTER_AUTH_URL, plus the Vite dev server outside production so local
  // sign-in works regardless of what the public URL points at.
  trustedOrigins: publicOrigins(process.env),
});

import { InvitationStatus } from "@/lib/db/enums";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import {
	admin,
	captcha,
	openAPI,
	organization,
	twoFactor,
	username,
} from "better-auth/plugins";
import { appConfig } from "@/config/app.config";
import { authConfig } from "@/config/auth.config";
import { getOrganizationPlanLimits } from "@/lib/billing/guards";
import { syncOrganizationSeats } from "@/lib/billing/seat-sync";
import { prisma } from "@/lib/db";
import {
	sendConfirmEmailAddressChangeEmail,
	sendOrganizationInvitationEmail,
	sendPasswordResetEmail,
	sendVerifyEmailAddressEmail,
} from "@/lib/email";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getBaseUrl } from "@/lib/utils";

const appUrl = getBaseUrl();

export const auth = betterAuth({
	baseURL: appUrl,
	trustedOrigins: authConfig.trustedOrigins,
	appName: appConfig.appName,
	database: prismaAdapter(prisma, {
		provider: "sqlite",
		usePlural: false,
		transaction: true,
	}),
	advanced: {
		database: {
			generateId: false,
		},
	},
	session: {
		expiresIn: authConfig.sessionCookieMaxAge,
		freshAge: 0,
	},
	user: {
		additionalFields: {
			onboardingComplete: {
				type: "boolean",
				required: false,
			},
			banned: {
				type: "boolean",
				required: false,
			},
			banReason: {
				type: "string",
				required: false,
			},
			banExpires: {
				type: "date",
				required: false,
			},
		},
		deleteUser: {
			enabled: true,
		},
		changeEmail: {
			enabled: true,
			sendChangeEmailVerification: async (
				{ user: { email, name }, url },
				_request,
			) => {
				await sendConfirmEmailAddressChangeEmail({
					recipient: email,
					name,
					confirmLink: url,
				});
			},
		},
	},
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ["google"],
		},
	},
	emailAndPassword: {
		enabled: true,
		autoSignIn: !env.RESEND_API_KEY,
		requireEmailVerification: !!env.RESEND_API_KEY,
		minPasswordLength: authConfig.minimumPasswordLength,
		sendResetPassword: env.RESEND_API_KEY
			? async ({ user, url }, _request) => {
					await sendPasswordResetEmail({
						recipient: user.email,
						appName: appConfig.appName,
						name: user.name,
						resetPasswordLink: url,
					});
				}
			: undefined,
	},
	emailVerification: {
		sendOnSignUp: !!env.RESEND_API_KEY,
		autoSignInAfterVerification: true,
		expiresIn: authConfig.verificationExpiresIn,
		sendVerificationEmail: env.RESEND_API_KEY
			? async ({ user: { email, name }, url }, _request) => {
					await sendVerifyEmailAddressEmail({
						recipient: email,
						name,
						verificationLink: url,
					});
				}
			: undefined,
	},
	socialProviders: {
		google: {
			prompt: "select_account",
			clientId: env.GOOGLE_CLIENT_ID ?? "",
			clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
			scope: ["email", "profile"],
		},
	},
	plugins: [
		username(),
		admin(),
		...(env.TURNSTILE_SECRET_KEY
			? [
					captcha({
						provider: "cloudflare-turnstile",
						secretKey: env.TURNSTILE_SECRET_KEY,
					}),
				]
			: []),
		organization({
			sendInvitationEmail: async (
				{ email, inviter, id, organization },
				_request,
			) => {
				// Check member limit before allowing invitation
				// Count current members + pending invitations against plan limit
				const [currentMembersCount, pendingInvitationsCount, planLimits] =
					await Promise.all([
						prisma.member.count({
							where: { organizationId: organization.id },
						}),
						prisma.invitation.count({
							where: {
								organizationId: organization.id,
								status: InvitationStatus.pending,
							},
						}),
						getOrganizationPlanLimits(organization.id),
					]);

				const totalPotentialMembers =
					currentMembersCount + pendingInvitationsCount;

				// -1 means unlimited
				if (
					planLimits.maxMembers !== -1 &&
					totalPotentialMembers >= planLimits.maxMembers
				) {
					throw new APIError("FORBIDDEN", {
						message: `You have reached the maximum number of team members (${planLimits.maxMembers}) for your plan. Please upgrade to invite more members.`,
					});
				}

				const existingUser = await prisma.user.findFirst({
					where: { email },
					select: { id: true },
				});

				const url = new URL(
					existingUser ? "/auth/sign-in" : "/auth/sign-up",
					getBaseUrl(),
				);

				url.searchParams.set("invitationId", id);
				url.searchParams.set("email", email);

				const inviterUser = await prisma.user.findFirst({
					where: { id: inviter.userId },
					select: { email: true, name: true },
				});

				await sendOrganizationInvitationEmail({
					recipient: email,
					appName: appConfig.appName,
					organizationName: organization.name,
					invitedByEmail: inviterUser?.email ?? "",
					invitedByName: inviterUser?.name ?? "",
					inviteLink: url.toString(),
				});
			},
			// Organization hooks for seat-based billing synchronization
			organizationHooks: {
				// Sync seats after a member is added (via direct add or invitation acceptance)
				afterAddMember: async ({ organization }) => {
					try {
						await syncOrganizationSeats(organization.id);
						logger.info("Synced seats after member added", {
							organizationId: organization.id,
						});
					} catch (error) {
						// Log but don't throw - member was added successfully,
						// seat sync can be retried or will be fixed by next sync
						logger.error("Failed to sync seats after member added", {
							organizationId: organization.id,
							error: error instanceof Error ? error.message : "Unknown error",
						});
					}
				},
				// Sync seats after a member is removed
				afterRemoveMember: async ({ organization }) => {
					try {
						await syncOrganizationSeats(organization.id);
						logger.info("Synced seats after member removed", {
							organizationId: organization.id,
						});
					} catch (error) {
						// Log but don't throw - member was removed successfully,
						// seat sync can be retried or will be fixed by next sync
						logger.error("Failed to sync seats after member removed", {
							organizationId: organization.id,
							error: error instanceof Error ? error.message : "Unknown error",
						});
					}
				},
				// Sync seats after invitation is accepted (member joins)
				afterAcceptInvitation: async ({ organization }) => {
					try {
						await syncOrganizationSeats(organization.id);
						logger.info("Synced seats after invitation accepted", {
							organizationId: organization.id,
						});
					} catch (error) {
						logger.error("Failed to sync seats after invitation accepted", {
							organizationId: organization.id,
							error: error instanceof Error ? error.message : "Unknown error",
						});
					}
				},
			},
		}),
		openAPI(),
		twoFactor(),
	],
	databaseHooks: {
		session: {
			create: {
				async before(session, ctx) {
					// Check if user is banned when creating a session
					const targetUser = await prisma.user.findFirst({
						where: { id: session.userId },
						select: {
							id: true,
							banned: true,
							banReason: true,
							banExpires: true,
						},
					});

					if (targetUser?.banned) {
						// Check if ban has expired
						if (
							targetUser.banExpires &&
							new Date(targetUser.banExpires) < new Date()
						) {
							// Update user to unban
							await prisma.user.update({
								where: { id: targetUser.id },
								data: {
									banned: false,
									banReason: null,
									banExpires: null,
								},
							});
						} else {
							// User is still banned
							let message =
								targetUser.banReason || "Your account has been suspended";
							if (targetUser.banExpires) {
								const expiryDate = new Date(
									targetUser.banExpires,
								).toLocaleDateString("en-US", {
									year: "numeric",
									month: "long",
									day: "numeric",
									hour: "2-digit",
									minute: "2-digit",
								});
								message += `|expires:${expiryDate}`;
							}
							throw new APIError("FORBIDDEN", {
								code: "USER_BANNED",
								message,
							});
						}
					}

					return { ...ctx, data: session };
				},
			},
		},
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path === "/sign-up/email" || ctx.path === "/sign-in/email") {
				// Check if user is banned when signing in
				if (ctx.path === "/sign-in/email") {
					const email = ctx.body?.email;
					const targetUser = email
						? await prisma.user.findFirst({
								where: { email },
								select: {
									id: true,
									banned: true,
									banReason: true,
									banExpires: true,
								},
							})
						: null;

					if (targetUser?.banned) {
						// Check if ban has expired
						if (
							targetUser.banExpires &&
							new Date(targetUser.banExpires) < new Date()
						) {
							// Update user to unban
							await prisma.user.update({
								where: { id: targetUser.id },
								data: {
									banned: false,
									banReason: null,
									banExpires: null,
								},
							});
						} else {
							// User is still banned
							let message =
								targetUser.banReason || "Your account has been suspended";
							if (targetUser.banExpires) {
								const expiryDate = new Date(
									targetUser.banExpires,
								).toLocaleDateString("en-US", {
									year: "numeric",
									month: "long",
									day: "numeric",
									hour: "2-digit",
									minute: "2-digit",
								});
								message += `|expires:${expiryDate}`;
							}
							throw new APIError("FORBIDDEN", {
								code: "USER_BANNED",
								message,
							});
						}
					}
				}
			}
		}),
	},
	onAPIError: {
		onError(error, ctx) {
			logger.error(error, "auth error", ctx);
		},
	},
});

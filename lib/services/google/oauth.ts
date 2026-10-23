import "server-only";

import { google } from "googleapis";
import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const SCOPES = {
	gmail: [
		"https://www.googleapis.com/auth/gmail.modify",
		"https://www.googleapis.com/auth/gmail.compose",
	],
	sheets: [
		"https://www.googleapis.com/auth/spreadsheets",
		"https://www.googleapis.com/auth/drive.file",
	],
	calendar: ["https://www.googleapis.com/auth/calendar"],
} as const;

export type IntegrationProvider = "gmail" | "sheets" | "calendar";

function getCredentials() {
	const clientId = process.env.GOOGLE_INTEGRATION_CLIENT_ID;
	const clientSecret = process.env.GOOGLE_INTEGRATION_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			"GOOGLE_INTEGRATION_CLIENT_ID and GOOGLE_INTEGRATION_CLIENT_SECRET must be set",
		);
	}
	return { clientId, clientSecret };
}

function getRedirectUri() {
	const siteUrl =
		process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
	return `${siteUrl}/api/google/callback`;
}

export function createOAuth2Client() {
	const { clientId, clientSecret } = getCredentials();
	return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

/**
 * Generate the Google OAuth consent URL for connecting an integration.
 * State contains the orgId and provider so we can route the callback correctly.
 */
export function getAuthUrl(
	organizationId: string,
	providers: IntegrationProvider[],
) {
	const client = createOAuth2Client();
	const scopes = providers.flatMap((p) => SCOPES[p]);

	const state = Buffer.from(
		JSON.stringify({ organizationId, providers }),
	).toString("base64url");

	return client.generateAuthUrl({
		access_type: "offline",
		prompt: "consent",
		scope: scopes,
		state,
	});
}

/**
 * Exchange an authorization code for tokens. Encrypts tokens before storing.
 */
export async function exchangeCodeForTokens(code: string) {
	const client = createOAuth2Client();
	const { tokens } = await client.getToken(code);
	return tokens;
}

/**
 * Save integration tokens to the database (encrypted).
 */
export async function saveIntegration(
	organizationId: string,
	provider: IntegrationProvider,
	tokens: {
		access_token?: string | null;
		refresh_token?: string | null;
		expiry_date?: number | null;
		scope?: string | null;
	},
	accountEmail?: string,
) {
	if (!tokens.access_token) {
		throw new Error("No access token received from Google");
	}

	const encryptedAccessToken = encrypt(tokens.access_token);
	const encryptedRefreshToken = tokens.refresh_token
		? encrypt(tokens.refresh_token)
		: null;

	const tokenExpiresAt = tokens.expiry_date
		? new Date(tokens.expiry_date)
		: null;

	await prisma.integration.upsert({
		where: {
			organizationId_provider: { organizationId, provider },
		},
		create: {
			organizationId,
			provider,
			accessToken: encryptedAccessToken,
			refreshToken: encryptedRefreshToken,
			tokenExpiresAt,
			scopes: tokens.scope ?? null,
			accountEmail: accountEmail ?? null,
			status: "connected",
			enabled: true,
		},
		update: {
			accessToken: encryptedAccessToken,
			refreshToken: encryptedRefreshToken ?? undefined,
			tokenExpiresAt,
			scopes: tokens.scope ?? undefined,
			accountEmail: accountEmail ?? undefined,
			status: "connected",
			errorMessage: null,
		},
	});

	logger.info(
		{ organizationId, provider },
		"Integration tokens saved",
	);
}

/**
 * Get an authenticated OAuth2 client for a specific integration.
 * Handles token decryption and automatic refresh.
 */
export async function getAuthenticatedClient(
	organizationId: string,
	provider: IntegrationProvider,
) {
	const integration = await prisma.integration.findUnique({
		where: {
			organizationId_provider: { organizationId, provider },
		},
	});

	if (!integration || integration.status === "disconnected") {
		throw new Error(`${provider} integration not connected`);
	}

	if (!integration.enabled) {
		throw new Error(`${provider} integration is disabled`);
	}

	const client = createOAuth2Client();

	const accessToken = decrypt(integration.accessToken);
	const refreshToken = integration.refreshToken
		? decrypt(integration.refreshToken)
		: null;

	client.setCredentials({
		access_token: accessToken,
		refresh_token: refreshToken,
		expiry_date: integration.tokenExpiresAt?.getTime() ?? undefined,
	});

	// Handle automatic token refresh
	client.on("tokens", async (tokens) => {
		try {
			const updates: Record<string, unknown> = {};
			if (tokens.access_token) {
				updates.accessToken = encrypt(tokens.access_token);
			}
			if (tokens.refresh_token) {
				updates.refreshToken = encrypt(tokens.refresh_token);
			}
			if (tokens.expiry_date) {
				updates.tokenExpiresAt = new Date(tokens.expiry_date);
			}

			await prisma.integration.update({
				where: { id: integration.id },
				data: updates,
			});

			logger.info(
				{ organizationId, provider },
				"Integration tokens refreshed",
			);
		} catch (error) {
			logger.error(
				{ error, organizationId, provider },
				"Failed to persist refreshed tokens",
			);
		}
	});

	return client;
}

/**
 * Disconnect an integration by marking it as disconnected.
 */
export async function disconnectIntegration(
	organizationId: string,
	provider: IntegrationProvider,
) {
	await prisma.integration.update({
		where: {
			organizationId_provider: { organizationId, provider },
		},
		data: {
			status: "disconnected",
			enabled: false,
		},
	});

	logger.info(
		{ organizationId, provider },
		"Integration disconnected",
	);
}

/**
 * Toggle an integration on/off.
 */
export async function toggleIntegration(
	organizationId: string,
	provider: IntegrationProvider,
	enabled: boolean,
) {
	await prisma.integration.update({
		where: {
			organizationId_provider: { organizationId, provider },
		},
		data: { enabled },
	});
}

/**
 * List all integrations for an organization.
 */
export async function listIntegrations(organizationId: string) {
	return prisma.integration.findMany({
		where: { organizationId },
		select: {
			id: true,
			provider: true,
			status: true,
			enabled: true,
			accountEmail: true,
			lastSyncAt: true,
			errorMessage: true,
			createdAt: true,
		},
	});
}

export { SCOPES };

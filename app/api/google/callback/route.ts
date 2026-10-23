import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { logger } from "@/lib/logger";
import {
	createOAuth2Client,
	exchangeCodeForTokens,
	saveIntegration,
	type IntegrationProvider,
} from "@/lib/services/google/oauth";

export async function GET(request: NextRequest) {
	const searchParams = request.nextUrl.searchParams;
	const code = searchParams.get("code");
	const stateParam = searchParams.get("state");
	const error = searchParams.get("error");

	const siteUrl =
		process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
	const redirectBase = `${siteUrl}/dashboard/organization/integrations`;

	if (error) {
		logger.error({ error }, "Google OAuth error");
		return NextResponse.redirect(
			`${redirectBase}?error=${encodeURIComponent(error)}`,
		);
	}

	if (!code || !stateParam) {
		return NextResponse.redirect(
			`${redirectBase}?error=missing_params`,
		);
	}

	let state: { organizationId: string; providers: IntegrationProvider[] };
	try {
		state = JSON.parse(
			Buffer.from(stateParam, "base64url").toString("utf8"),
		);
	} catch {
		return NextResponse.redirect(
			`${redirectBase}?error=invalid_state`,
		);
	}

	try {
		const tokens = await exchangeCodeForTokens(code);

		// Get the user's email from the token
		let accountEmail: string | undefined;
		try {
			const client = createOAuth2Client();
			client.setCredentials(tokens);
			const oauth2 = google.oauth2({ version: "v2", auth: client });
			const userInfo = await oauth2.userinfo.get();
			accountEmail = userInfo.data.email ?? undefined;
		} catch {
			// Non-critical — we can proceed without the email
		}

		// Save integration for each provider
		for (const provider of state.providers) {
			await saveIntegration(
				state.organizationId,
				provider,
				tokens,
				accountEmail,
			);
		}

		logger.info(
			{
				organizationId: state.organizationId,
				providers: state.providers,
			},
			"Google integrations connected successfully",
		);

		return NextResponse.redirect(
			`${redirectBase}?success=true`,
		);
	} catch (err) {
		logger.error(
			{ error: err, organizationId: state.organizationId },
			"Failed to exchange Google OAuth code",
		);
		return NextResponse.redirect(
			`${redirectBase}?error=token_exchange_failed`,
		);
	}
}

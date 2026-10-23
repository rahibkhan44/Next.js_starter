import "server-only";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createGmailTools } from "./tools/gmail.tools";
import { createSheetsTools } from "./tools/sheets.tools";
import { createCalendarTools } from "./tools/calendar.tools";
import { wrapToolsWithLogging } from "./activity-logger";

/**
 * Returns available AI tools based on the organization's connected and enabled integrations.
 * Only tools for active integrations are returned to the model.
 */
export async function getAvailableTools(
	organizationId: string,
	userId: string,
) {
	const integrations = await prisma.integration.findMany({
		where: {
			organizationId,
			status: "connected",
			enabled: true,
		},
		select: { provider: true },
	});

	const connectedProviders = new Set(
		integrations.map((i) => i.provider),
	);

	// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool types are complex and vary by version
	const tools: Record<string, any> = {};

	if (connectedProviders.has("gmail")) {
		Object.assign(tools, createGmailTools(organizationId));
	}

	if (connectedProviders.has("sheets")) {
		Object.assign(tools, createSheetsTools(organizationId));
	}

	if (connectedProviders.has("calendar")) {
		Object.assign(tools, createCalendarTools(organizationId));
	}

	logger.info(
		{
			organizationId,
			connectedProviders: [...connectedProviders],
			availableTools: Object.keys(tools),
		},
		"Built tool registry",
	);

	// Wrap all tools with activity logging
	return wrapToolsWithLogging(tools, organizationId, userId);
}

/**
 * Get a description of available tools for the system prompt.
 */
export async function getToolSummary(
	organizationId: string,
): Promise<string> {
	const integrations = await prisma.integration.findMany({
		where: {
			organizationId,
			status: "connected",
			enabled: true,
		},
		select: { provider: true, accountEmail: true },
	});

	if (integrations.length === 0) {
		return "No Google integrations are connected. You can only have a general conversation. Suggest the user connect their Google account in the Integrations settings.";
	}

	const summaries = integrations.map((i) => {
		const email = i.accountEmail ? ` (${i.accountEmail})` : "";
		switch (i.provider) {
			case "gmail":
				return `- Gmail${email}: list emails, read emails, send emails, create drafts`;
			case "sheets":
				return `- Google Sheets${email}: list spreadsheets, read data, write data, append rows`;
			case "calendar":
				return `- Google Calendar${email}: list events, create events, find free time slots`;
			default:
				return "";
		}
	});

	return `Connected integrations:\n${summaries.filter(Boolean).join("\n")}`;
}

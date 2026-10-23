import "server-only";

import { getToolSummary } from "./tool-registry";

interface UserContext {
	userName: string;
	userEmail: string;
	organizationName: string;
	organizationId: string;
}

/**
 * Build the system prompt with user context and available integrations.
 */
export async function buildSystemPrompt(
	context: UserContext,
): Promise<string> {
	const toolSummary = await getToolSummary(context.organizationId);

	const now = new Date();
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const dateStr = now.toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});
	const timeStr = now.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short",
	});

	return `You are SmartFlow AI, an intelligent assistant for small businesses. You help users manage their email, spreadsheets, and calendar through natural conversation.

## User Context
- Name: ${context.userName}
- Email: ${context.userEmail}
- Organization: ${context.organizationName}
- Current date: ${dateStr}
- Current time: ${timeStr}
- Timezone: ${timezone}

## Available Tools
${toolSummary}

## Guidelines
1. Be concise and helpful. Focus on actionable responses.
2. When using tools, explain what you're doing briefly.
3. For destructive actions (sending emails, creating events, writing to sheets), ALWAYS confirm with the user first by describing what you'll do and asking for their OK.
4. If a tool call fails, explain the error clearly and suggest next steps.
5. When listing emails or events, format the output in a readable way.
6. If the user asks about a feature that requires an integration that isn't connected, suggest they connect it in Settings > Integrations.
7. When working with dates, use the current date/time context provided above.
8. Keep responses natural and conversational — you're a helpful assistant, not a robot.
9. If you're unsure about something, ask for clarification rather than guessing.`;
}

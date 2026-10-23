import "server-only";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// Map tool names to their provider
const TOOL_PROVIDER_MAP: Record<string, string> = {
	list_emails: "gmail",
	read_email: "gmail",
	send_email: "gmail",
	draft_email: "gmail",
	list_spreadsheets: "sheets",
	read_sheet_range: "sheets",
	write_sheet_range: "sheets",
	append_sheet_data: "sheets",
	list_events: "calendar",
	create_event: "calendar",
	find_free_slots: "calendar",
};

/**
 * Log a tool execution to the ActivityLog table.
 */
export async function logActivity(params: {
	organizationId: string;
	userId: string;
	toolName: string;
	toolArgs?: unknown;
	result?: unknown;
	status: "success" | "error";
	errorMessage?: string;
	durationMs: number;
}) {
	try {
		await prisma.activityLog.create({
			data: {
				organizationId: params.organizationId,
				userId: params.userId,
				provider: TOOL_PROVIDER_MAP[params.toolName] ?? null,
				toolName: params.toolName,
				toolArgs: params.toolArgs
					? JSON.stringify(params.toolArgs)
					: null,
				result: params.result
					? JSON.stringify(params.result).slice(0, 5000)
					: null,
				status: params.status,
				errorMessage: params.errorMessage ?? null,
				durationMs: params.durationMs,
			},
		});
	} catch (error) {
		logger.error(
			{ error, toolName: params.toolName },
			"Failed to log activity",
		);
	}
}

type ToolWithExecute = {
	execute?: (args: unknown, options: unknown) => Promise<unknown>;
	[key: string]: unknown;
};

/**
 * Wraps tools with activity logging. Each tool execution is timed and logged.
 */
export function wrapToolsWithLogging(
	tools: Record<string, ToolWithExecute>,
	organizationId: string,
	userId: string,
): Record<string, ToolWithExecute> {
	const wrapped: Record<string, ToolWithExecute> = {};

	for (const [name, originalTool] of Object.entries(tools)) {
		if (originalTool.execute) {
			const originalExecute = originalTool.execute;

			wrapped[name] = {
				...originalTool,
				execute: async (args: unknown, options: unknown) => {
					const startTime = Date.now();

					try {
						const result = await originalExecute(args, options);
						const durationMs = Date.now() - startTime;

						await logActivity({
							organizationId,
							userId,
							toolName: name,
							toolArgs: args,
							result,
							status: "success",
							durationMs,
						});

						return result;
					} catch (error) {
						const durationMs = Date.now() - startTime;
						const errorMessage =
							error instanceof Error
								? error.message
								: "Unknown error";

						await logActivity({
							organizationId,
							userId,
							toolName: name,
							toolArgs: args,
							status: "error",
							errorMessage,
							durationMs,
						});

						logger.error(
							{
								error,
								toolName: name,
								organizationId,
							},
							"Tool execution failed",
						);

						// Return error to the model so it can inform the user
						return {
							error: errorMessage,
							suggestion:
								"The tool call failed. Please inform the user about the error.",
						};
					}
				},
			};
		} else {
			wrapped[name] = originalTool;
		}
	}

	return wrapped;
}

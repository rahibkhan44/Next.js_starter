import { z } from "zod";
import { GmailService } from "@/lib/services/google/gmail";

// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool() types are complex with zod v3/v4 interop
type AnyTool = any;

export function createGmailTools(organizationId: string): Record<string, AnyTool> {
	const gmail = new GmailService(organizationId);
	// Dynamic import to avoid TypeScript resolving tool() against zod/v4
	// biome-ignore lint/style/noCommaOperator: intentional
	const { tool } = require("ai") as { tool: (...args: unknown[]) => AnyTool };

	return {
		list_emails: tool({
			description:
				"List recent emails from the user's Gmail inbox. Can filter by search query and label.",
			parameters: z.object({
				maxResults: z
					.number()
					.min(1)
					.max(20)
					.optional()
					.describe("Maximum number of emails to return (default 10)"),
				query: z
					.string()
					.optional()
					.describe(
						"Gmail search query (e.g. 'from:john@example.com', 'is:unread', 'subject:meeting')",
					),
			}),
			execute: async (args: { maxResults?: number; query?: string }) => {
				return gmail.listEmails({
					maxResults: args.maxResults,
					query: args.query,
				});
			},
		}),

		read_email: tool({
			description:
				"Read the full content of a specific email by its ID. Use list_emails first to get email IDs.",
			parameters: z.object({
				messageId: z.string().describe("The Gmail message ID to read"),
			}),
			execute: async (args: { messageId: string }) => {
				return gmail.getEmail(args.messageId);
			},
		}),

		send_email: tool({
			description:
				"Send an email via Gmail. Always confirm with the user before sending.",
			parameters: z.object({
				to: z.string().describe("Recipient email address"),
				subject: z.string().describe("Email subject line"),
				body: z.string().describe("Email body text"),
				cc: z.string().optional().describe("CC email address"),
				bcc: z.string().optional().describe("BCC email address"),
			}),
			execute: async (args: {
				to: string;
				subject: string;
				body: string;
				cc?: string;
				bcc?: string;
			}) => {
				return gmail.sendEmail(args);
			},
		}),

		draft_email: tool({
			description:
				"Create a draft email in Gmail without sending it. Good for preparing emails for user review.",
			parameters: z.object({
				to: z.string().describe("Recipient email address"),
				subject: z.string().describe("Email subject line"),
				body: z.string().describe("Email body text"),
			}),
			execute: async (args: {
				to: string;
				subject: string;
				body: string;
			}) => {
				return gmail.createDraft(args);
			},
		}),
	};
}

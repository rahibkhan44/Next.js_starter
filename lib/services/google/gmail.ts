import "server-only";

import { google } from "googleapis";
import { logger } from "@/lib/logger";
import { getAuthenticatedClient } from "./oauth";

export class GmailService {
	private organizationId: string;

	constructor(organizationId: string) {
		this.organizationId = organizationId;
	}

	private async getClient() {
		const auth = await getAuthenticatedClient(
			this.organizationId,
			"gmail",
		);
		return google.gmail({ version: "v1", auth });
	}

	/**
	 * List recent emails from the inbox.
	 */
	async listEmails(options?: {
		maxResults?: number;
		query?: string;
		labelIds?: string[];
	}) {
		const gmail = await this.getClient();
		const { maxResults = 10, query, labelIds } = options ?? {};

		const response = await gmail.users.messages.list({
			userId: "me",
			maxResults,
			q: query,
			labelIds,
		});

		if (!response.data.messages?.length) {
			return [];
		}

		const emails = await Promise.all(
			response.data.messages.map(async (msg) => {
				const full = await gmail.users.messages.get({
					userId: "me",
					id: msg.id!,
					format: "metadata",
					metadataHeaders: [
						"From",
						"To",
						"Subject",
						"Date",
					],
				});

				const headers = full.data.payload?.headers ?? [];
				const getHeader = (name: string) =>
					headers.find(
						(h) =>
							h.name?.toLowerCase() === name.toLowerCase(),
					)?.value ?? "";

				return {
					id: full.data.id!,
					threadId: full.data.threadId!,
					snippet: full.data.snippet ?? "",
					from: getHeader("From"),
					to: getHeader("To"),
					subject: getHeader("Subject"),
					date: getHeader("Date"),
					labelIds: full.data.labelIds ?? [],
					isUnread:
						full.data.labelIds?.includes("UNREAD") ?? false,
				};
			}),
		);

		return emails;
	}

	/**
	 * Get a full email by ID.
	 */
	async getEmail(messageId: string) {
		const gmail = await this.getClient();

		const response = await gmail.users.messages.get({
			userId: "me",
			id: messageId,
			format: "full",
		});

		const headers = response.data.payload?.headers ?? [];
		const getHeader = (name: string) =>
			headers.find(
				(h) => h.name?.toLowerCase() === name.toLowerCase(),
			)?.value ?? "";

		// Extract body text
		let body = "";
		const payload = response.data.payload;
		if (payload?.body?.data) {
			body = Buffer.from(payload.body.data, "base64url").toString(
				"utf8",
			);
		} else if (payload?.parts) {
			const textPart = payload.parts.find(
				(p) => p.mimeType === "text/plain",
			);
			if (textPart?.body?.data) {
				body = Buffer.from(
					textPart.body.data,
					"base64url",
				).toString("utf8");
			}
		}

		return {
			id: response.data.id!,
			threadId: response.data.threadId!,
			from: getHeader("From"),
			to: getHeader("To"),
			subject: getHeader("Subject"),
			date: getHeader("Date"),
			body,
			labelIds: response.data.labelIds ?? [],
		};
	}

	/**
	 * Send an email.
	 */
	async sendEmail(options: {
		to: string;
		subject: string;
		body: string;
		cc?: string;
		bcc?: string;
	}) {
		const gmail = await this.getClient();
		const { to, subject, body, cc, bcc } = options;

		const messageParts = [
			`To: ${to}`,
			`Subject: ${subject}`,
			"Content-Type: text/plain; charset=utf-8",
		];
		if (cc) messageParts.splice(1, 0, `Cc: ${cc}`);
		if (bcc) messageParts.splice(1, 0, `Bcc: ${bcc}`);
		messageParts.push("", body);

		const raw = Buffer.from(messageParts.join("\r\n")).toString(
			"base64url",
		);

		const response = await gmail.users.messages.send({
			userId: "me",
			requestBody: { raw },
		});

		logger.info(
			{ organizationId: this.organizationId, messageId: response.data.id },
			"Email sent via Gmail",
		);

		return {
			id: response.data.id!,
			threadId: response.data.threadId!,
		};
	}

	/**
	 * Create a draft email.
	 */
	async createDraft(options: {
		to: string;
		subject: string;
		body: string;
	}) {
		const gmail = await this.getClient();
		const { to, subject, body } = options;

		const messageParts = [
			`To: ${to}`,
			`Subject: ${subject}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			body,
		];

		const raw = Buffer.from(messageParts.join("\r\n")).toString(
			"base64url",
		);

		const response = await gmail.users.drafts.create({
			userId: "me",
			requestBody: {
				message: { raw },
			},
		});

		logger.info(
			{ organizationId: this.organizationId, draftId: response.data.id },
			"Draft created via Gmail",
		);

		return {
			id: response.data.id!,
			messageId: response.data.message?.id!,
		};
	}
}

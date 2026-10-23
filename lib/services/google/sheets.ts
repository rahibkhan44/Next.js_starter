import "server-only";

import { google } from "googleapis";
import { logger } from "@/lib/logger";
import { getAuthenticatedClient } from "./oauth";

export class SheetsService {
	private organizationId: string;

	constructor(organizationId: string) {
		this.organizationId = organizationId;
	}

	private async getClient() {
		const auth = await getAuthenticatedClient(
			this.organizationId,
			"sheets",
		);
		return google.sheets({ version: "v4", auth });
	}

	private async getDriveClient() {
		const auth = await getAuthenticatedClient(
			this.organizationId,
			"sheets",
		);
		return google.drive({ version: "v3", auth });
	}

	/**
	 * List spreadsheets accessible to the user.
	 */
	async listSpreadsheets(options?: { maxResults?: number }) {
		const drive = await this.getDriveClient();
		const { maxResults = 20 } = options ?? {};

		const response = await drive.files.list({
			q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
			pageSize: maxResults,
			fields: "files(id, name, modifiedTime, webViewLink)",
			orderBy: "modifiedTime desc",
		});

		return (response.data.files ?? []).map((file) => ({
			id: file.id!,
			name: file.name!,
			modifiedTime: file.modifiedTime ?? null,
			webViewLink: file.webViewLink ?? null,
		}));
	}

	/**
	 * Read data from a spreadsheet range.
	 */
	async readRange(spreadsheetId: string, range: string) {
		const sheets = await this.getClient();

		const response = await sheets.spreadsheets.values.get({
			spreadsheetId,
			range,
		});

		return {
			range: response.data.range ?? range,
			values: (response.data.values as string[][]) ?? [],
		};
	}

	/**
	 * Write data to a spreadsheet range.
	 */
	async writeRange(
		spreadsheetId: string,
		range: string,
		values: string[][],
	) {
		const sheets = await this.getClient();

		const response = await sheets.spreadsheets.values.update({
			spreadsheetId,
			range,
			valueInputOption: "USER_ENTERED",
			requestBody: { values },
		});

		logger.info(
			{
				organizationId: this.organizationId,
				spreadsheetId,
				range,
				updatedCells: response.data.updatedCells,
			},
			"Spreadsheet data written",
		);

		return {
			updatedRange: response.data.updatedRange ?? range,
			updatedRows: response.data.updatedRows ?? 0,
			updatedColumns: response.data.updatedColumns ?? 0,
			updatedCells: response.data.updatedCells ?? 0,
		};
	}

	/**
	 * Append data to the end of a spreadsheet range.
	 */
	async appendRange(
		spreadsheetId: string,
		range: string,
		values: string[][],
	) {
		const sheets = await this.getClient();

		const response = await sheets.spreadsheets.values.append({
			spreadsheetId,
			range,
			valueInputOption: "USER_ENTERED",
			insertDataOption: "INSERT_ROWS",
			requestBody: { values },
		});

		logger.info(
			{
				organizationId: this.organizationId,
				spreadsheetId,
				range,
				updatedCells: response.data.updates?.updatedCells,
			},
			"Spreadsheet data appended",
		);

		return {
			updatedRange: response.data.updates?.updatedRange ?? range,
			updatedRows: response.data.updates?.updatedRows ?? 0,
			updatedCells: response.data.updates?.updatedCells ?? 0,
		};
	}
}

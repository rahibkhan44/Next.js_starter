import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type * as React from "react";
import { IntegrationsPanel } from "@/components/organization/integrations-panel";
import {
	Page,
	PageBody,
	PageBreadcrumb,
	PageContent,
	PageHeader,
	PagePrimaryBar,
} from "@/components/ui/custom/page";
import { getOrganizationById, getSession } from "@/lib/auth/server";

export const metadata: Metadata = {
	title: "Integrations",
};

export default async function IntegrationsPage(): Promise<React.JSX.Element> {
	const session = await getSession();
	if (!session?.session.activeOrganizationId) {
		redirect("/dashboard");
	}

	const organization = await getOrganizationById(
		session.session.activeOrganizationId,
	);
	if (!organization) {
		redirect("/dashboard");
	}

	return (
		<Page>
			<PageHeader>
				<PagePrimaryBar>
					<PageBreadcrumb
						segments={[
							{ label: "Home", href: "/dashboard" },
							{ label: organization.name, href: "/dashboard/organization" },
							{ label: "Integrations" },
						]}
					/>
				</PagePrimaryBar>
			</PageHeader>
			<PageBody>
				<PageContent title="Integrations">
					<IntegrationsPanel />
				</PageContent>
			</PageBody>
		</Page>
	);
}

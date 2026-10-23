"use client";

import { Mail, Sheet, CalendarDays, ExternalLink, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/trpc/client";

const INTEGRATION_CONFIG = {
	gmail: {
		name: "Gmail",
		description: "Read, send, and draft emails",
		icon: Mail,
		color: "text-red-500",
	},
	sheets: {
		name: "Google Sheets",
		description: "Read and write spreadsheet data",
		icon: Sheet,
		color: "text-green-600",
	},
	calendar: {
		name: "Google Calendar",
		description: "View events and manage your schedule",
		icon: CalendarDays,
		color: "text-blue-500",
	},
} as const;

type Provider = keyof typeof INTEGRATION_CONFIG;

export function IntegrationsPanel() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const utils = trpc.useUtils();

	const { data: integrations, isLoading } =
		trpc.organization.integration.list.useQuery();

	const connectMutation =
		trpc.organization.integration.getConnectUrl.useMutation({
			onSuccess: (data) => {
				window.location.href = data.url;
			},
			onError: (error) => {
				toast.error(error.message);
			},
		});

	const disconnectMutation =
		trpc.organization.integration.disconnect.useMutation({
			onSuccess: () => {
				toast.success("Integration disconnected");
				utils.organization.integration.list.invalidate();
			},
			onError: (error) => {
				toast.error(error.message);
			},
		});

	const toggleMutation =
		trpc.organization.integration.toggle.useMutation({
			onSuccess: () => {
				utils.organization.integration.list.invalidate();
			},
			onError: (error) => {
				toast.error(error.message);
			},
		});

	// Handle callback success/error
	useEffect(() => {
		const success = searchParams.get("success");
		const error = searchParams.get("error");

		if (success === "true") {
			toast.success("Google integration connected successfully!");
			router.replace("/dashboard/organization/integrations");
		} else if (error) {
			toast.error(`Failed to connect: ${error.replace(/_/g, " ")}`);
			router.replace("/dashboard/organization/integrations");
		}
	}, [searchParams, router]);

	const getIntegration = (provider: Provider) =>
		integrations?.find((i) => i.provider === provider);

	const handleConnectAll = () => {
		const unconnected = (
			Object.keys(INTEGRATION_CONFIG) as Provider[]
		).filter((p) => {
			const integration = getIntegration(p);
			return !integration || integration.status === "disconnected";
		});

		if (unconnected.length === 0) {
			toast.info("All integrations are already connected");
			return;
		}

		connectMutation.mutate({ providers: unconnected });
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">
					Connect your Google account to enable AI-powered workflows.
				</p>
				<Button
					onClick={handleConnectAll}
					disabled={connectMutation.isPending}
				>
					{connectMutation.isPending && (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					)}
					Connect Google Account
				</Button>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				{(Object.keys(INTEGRATION_CONFIG) as Provider[]).map(
					(provider) => {
						const config = INTEGRATION_CONFIG[provider];
						const integration = getIntegration(provider);
						const isConnected =
							integration?.status === "connected";
						const Icon = config.icon;

						return (
							<Card key={provider}>
								<CardHeader className="pb-3">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-3">
											<Icon
												className={`h-5 w-5 ${config.color}`}
											/>
											<CardTitle className="text-base">
												{config.name}
											</CardTitle>
										</div>
										<Badge
											variant={
												isConnected
													? "default"
													: "secondary"
											}
										>
											{isConnected
												? "Connected"
												: "Not connected"}
										</Badge>
									</div>
									<CardDescription>
										{config.description}
									</CardDescription>
								</CardHeader>
								<CardContent>
									{isConnected ? (
										<div className="space-y-3">
											{integration?.accountEmail && (
												<p className="text-xs text-muted-foreground">
													{integration.accountEmail}
												</p>
											)}
											<div className="flex items-center justify-between">
												<span className="text-sm">
													Enabled
												</span>
												<Switch
													checked={
														integration?.enabled ??
														false
													}
													onCheckedChange={(
														checked,
													) => {
														toggleMutation.mutate({
															provider,
															enabled: checked,
														});
													}}
													disabled={
														toggleMutation.isPending
													}
												/>
											</div>
											<Button
												variant="outline"
												size="sm"
												className="w-full"
												onClick={() =>
													disconnectMutation.mutate({
														provider,
													})
												}
												disabled={
													disconnectMutation.isPending
												}
											>
												Disconnect
											</Button>
										</div>
									) : (
										<Button
											variant="outline"
											size="sm"
											className="w-full"
											onClick={() =>
												connectMutation.mutate({
													providers: [provider],
												})
											}
											disabled={
												connectMutation.isPending
											}
										>
											<ExternalLink className="mr-2 h-4 w-4" />
											Connect
										</Button>
									)}
								</CardContent>
							</Card>
						);
					},
				)}
			</div>

			{integrations?.some((i) => i.errorMessage) && (
				<Card className="border-destructive">
					<CardHeader>
						<CardTitle className="text-base text-destructive">
							Integration Errors
						</CardTitle>
					</CardHeader>
					<CardContent>
						{integrations
							.filter((i) => i.errorMessage)
							.map((i) => (
								<p
									key={i.id}
									className="text-sm text-muted-foreground"
								>
									<strong>{i.provider}:</strong>{" "}
									{i.errorMessage}
								</p>
							))}
					</CardContent>
				</Card>
			)}
		</div>
	);
}

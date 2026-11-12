"use client";

import { Button } from "@cline/ui";
import { Check, Palette } from "lucide-react";
import { useEffect, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	DEFAULT_HUB_THEME_PRESET,
	getHubThemePreset,
	HUB_THEME_PRESETS,
	type HubThemePresetDefinition,
	type HubThemePresetId,
	readStoredHubThemePreset,
	selectHubThemePreset,
	subscribeToHubThemePreset,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const MODE_PRESETS = HUB_THEME_PRESETS.filter(
	(preset) => preset.category === "mode",
);
const KAUI_PRESETS = HUB_THEME_PRESETS.filter(
	(preset) => preset.category === "kaui",
);
const POPULAR_PRESETS = HUB_THEME_PRESETS.filter(
	(preset) => preset.category === "popular",
);

function PresetSwatch({ preset }: { preset: HubThemePresetDefinition }) {
	if (preset.id === "system") {
		return (
			<span
				aria-hidden="true"
				className="relative inline-flex size-4 shrink-0 overflow-hidden rounded-full border border-border/80"
			>
				<span className="h-full w-1/2 bg-[#fbfbfe]" />
				<span className="h-full w-1/2 bg-[#16161d]" />
			</span>
		);
	}

	return (
		<span
			aria-hidden="true"
			className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full border"
			style={{
				backgroundColor: preset.preview.background,
				borderColor: preset.preview.border,
			}}
		>
			<span
				className="size-2 rounded-full"
				style={{ backgroundColor: preset.preview.primary }}
			/>
		</span>
	);
}

export function ThemeSwitcherMenu({
	align = "start",
	className,
}: {
	align?: "start" | "center" | "end";
	className?: string;
}) {
	const [preset, setPreset] = useState<HubThemePresetId>(() => {
		if (typeof window === "undefined") return DEFAULT_HUB_THEME_PRESET;
		return readStoredHubThemePreset();
	});

	useEffect(() => {
		setPreset(readStoredHubThemePreset());
		return subscribeToHubThemePreset(setPreset);
	}, []);

	const activeDefinition = getHubThemePreset(preset);

	const handleSelect = (nextPreset: HubThemePresetId) => {
		setPreset(selectHubThemePreset(nextPreset));
	};

	const renderItem = (item: HubThemePresetDefinition) => {
		const isSelected = preset === item.id;
		return (
			<DropdownMenuItem
				className="flex items-center gap-2.5 py-1.5"
				key={item.id}
				onSelect={() => handleSelect(item.id)}
			>
				<PresetSwatch preset={item} />
				<span className={cn("flex-1 truncate", isSelected && "font-medium")}>
					{item.label}
				</span>
				{isSelected ? <Check className="size-3.5 text-primary" /> : null}
			</DropdownMenuItem>
		);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label="Change theme"
					className={cn("size-9 shrink-0 justify-center px-0", className)}
					title={`Theme: ${activeDefinition.label}`}
					type="button"
					variant="sidebarItem"
				>
					<Palette className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align={align} className="w-56" side="top">
				<DropdownMenuLabel className="text-xs text-muted-foreground">
					Appearance
				</DropdownMenuLabel>
				<DropdownMenuGroup>{MODE_PRESETS.map(renderItem)}</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-xs text-muted-foreground">
					KAUI Presets
				</DropdownMenuLabel>
				<DropdownMenuGroup>{KAUI_PRESETS.map(renderItem)}</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel className="text-xs text-muted-foreground">
					Popular Themes
				</DropdownMenuLabel>
				<DropdownMenuGroup>{POPULAR_PRESETS.map(renderItem)}</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

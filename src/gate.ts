import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, InputEventResult } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { exercises } from "./exercises.ts";
import { getRuntimeDirectory } from "./runtime.ts";
import { defaults, validateSettings, type WorkoutSettings } from "./settings.ts";
import type { GateJob, GateResult, startWorker } from "./worker.ts";

export interface GateDependencies {
	settingsPath: string;
	start: typeof startWorker;
}
export function installWorkoutGate(pi: ExtensionAPI, dependencies: GateDependencies): void {
	let settings = { ...defaults };
	let configurationError: string | undefined;
	let active: GateJob | undefined;
	try {
		if (existsSync(dependencies.settingsPath))
			settings = validateSettings(JSON.parse(readFileSync(dependencies.settingsPath, "utf8")));
	} catch (error) {
		configurationError = error instanceof Error ? error.message : String(error);
	}
	const status = (ctx: ExtensionContext) =>
		ctx.ui.setStatus("workout", `${exercises[settings.exercise].label}: ${settings.reps}`);
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") {
			status(ctx);
			if (configurationError)
				ctx.ui.notify(`Workout settings invalid: ${configurationError}. Use /workout reset.`, "error");
		}
	});
	pi.on("session_shutdown", () => active?.cancel());
	pi.registerCommand("workout", {
		description:
			"Configure workout: /workout [setup | exercise NAME | reps N | camera N | confidence N | upAngle N | downAngle N | holdMs N | reset]",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			if (active) {
				ctx.ui.notify("Close the camera gate before changing settings.", "warning");
				return;
			}
			try {
				let input = args.trim();
				if (!input) {
					const choice = await ctx.ui.select("Workout gate settings", [...Object.keys(defaults), "setup", "reset"]);
					if (!choice) return;
					if (choice === "reset" || choice === "setup") input = choice;
					else if (choice === "exercise") {
						const selected = await ctx.ui.select("Choose exercise", Object.keys(exercises));
						if (!selected) return;
						input = `exercise ${selected}`;
					} else {
						const value = await ctx.ui.input(`Set ${choice} (currently ${settings[choice as keyof WorkoutSettings]})`);
						if (value === undefined) return;
						input = `${choice} ${value}`;
					}
				}
				if (input === "setup" || input.startsWith("setup ")) {
					const python = input === "setup" ? "python3.12" : input.slice(6).trim();
					ctx.ui.notify("Installing native camera dependencies and verified pose model…", "info");
					const setup = await pi.exec(
						python,
						[fileURLToPath(new URL("../native/setup.py", import.meta.url)), "--data-dir", getRuntimeDirectory()],
						{ timeout: 180000 },
					);
					if (setup.code !== 0)
						throw new Error(
							`Native setup failed. ${setup.stderr.slice(-1500)} Use /workout setup /absolute/path/to/python3.12.`,
						);
					ctx.ui.notify("Native camera setup complete. Your next prompt will open the workout gate.", "info");
					return;
				}
				let next: WorkoutSettings;
				if (input === "reset") next = { ...defaults };
				else {
					const parts = input.split(/\s+/);
					if (parts.length === 1 && /^\d+$/.test(parts[0])) parts.unshift("reps");
					const [key, value] = parts;
					if (parts.length !== 2 || !Object.hasOwn(defaults, key) || !value?.trim())
						throw new Error("Usage: /workout reps 3 (or /workout to open settings).");
					if (key === "exercise" && !Object.hasOwn(exercises, value))
						throw new Error("Unknown exercise. Choose curls, pullups, pushups, squats or situps.");
					next = validateSettings({
						...settings,
						...(key === "exercise" ? exercises[value].angles : {}),
						[key]: key === "exercise" ? value : Number(value),
					});
				}
				await mkdir(dirname(dependencies.settingsPath), { recursive: true });
				const temporary = `${dependencies.settingsPath}.${process.pid}.tmp`;
				await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
				await rename(temporary, dependencies.settingsPath);
				settings = next;
				configurationError = undefined;
				status(ctx);
				ctx.ui.notify(`Workout settings: ${JSON.stringify(settings)}`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
	pi.on("input", async (event, ctx): Promise<InputEventResult> => {
		if (event.source === "extension" || (!event.text.trim() && !event.images?.length)) return { action: "continue" };
		if (configurationError) {
			ctx.ui.notify("Invalid workout settings. Use /workout reset.", "error");
			if (ctx.mode === "tui") ctx.ui.setEditorText(event.text);
			return { action: "handled" };
		}
		if (settings.reps === 0) return { action: "continue" };
		if (ctx.mode !== "tui" || event.source !== "interactive") {
			ctx.ui.notify("Workout gate requires Pi TUI. Configure zero reps in the TUI to disable it.", "error");
			return { action: "handled" };
		}
		if (active) {
			ctx.ui.notify("A camera gate is already active.", "warning");
			return { action: "handled" };
		}
		let outcome: GateResult = { status: "cancelled" };
		try {
			outcome = await ctx.ui.custom<GateResult>((tui, theme, keybindings, done) => {
				let count = 0,
					disposed = false;
				active = dependencies.start({ ...settings }, (value) => {
					count = value;
					tui.requestRender();
				});
				const job = active;
				void job.result.then((result) => {
					if (!disposed) done(result);
				});
				return {
					render: (width: number) => [
						truncateToWidth(
							theme.fg(
								"accent",
								`${exercises[settings.exercise].label} ${count}/${settings.reps} — your prompt is held`,
							),
							width,
						),
						truncateToWidth(exercises[settings.exercise].instructions, width),
						truncateToWidth(
							`${keybindings.getKeys("app.interrupt").join("/")} cancels and restores your draft.`,
							width,
						),
					],
					handleInput: (data: string) => {
						if (keybindings.matches(data, "app.interrupt") || keybindings.matches(data, "app.clear")) job.cancel();
					},
					invalidate: () => {},
					dispose: () => {
						disposed = true;
						job.cancel();
					},
				};
			});
		} catch (error) {
			outcome = { status: "error", message: error instanceof Error ? error.message : String(error) };
		} finally {
			active = undefined;
			status(ctx);
		}
		if (outcome.status === "complete") return { action: "continue" };
		ctx.ui.setEditorText(event.text);
		ctx.ui.notify(
			outcome.status === "error" ? `${outcome.message} Prompt restored.` : "Workout gate cancelled. Prompt restored.",
			outcome.status === "error" ? "error" : "info",
		);
		if (event.images?.length) ctx.ui.notify("Reattach images before resubmitting the restored draft.", "warning");
		return { action: "handled" };
	});
}

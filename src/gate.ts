import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext, InputEventResult } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { exercises } from "./exercises.ts";
import { defaults, validateSettings, type WorkoutSettings } from "./settings.ts";
import type { SetupOptions } from "./setup.ts";
import type { GateJob, GateResult, startWorker } from "./worker.ts";

export interface GateDependencies {
	settingsPath: string;
	start: typeof startWorker;
	prepare?: (options?: SetupOptions) => Promise<void>;
}
export function installWorkoutGate(pi: ExtensionAPI, dependencies: GateDependencies): void {
	let settings = { ...defaults };
	let configurationError: string | undefined;
	let active: GateJob | undefined;
	let gateOpen = false;
	let cancelPreparation: (() => void) | undefined;
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
	pi.on("session_shutdown", () => {
		cancelPreparation?.();
		active?.cancel();
	});
	pi.registerCommand("workout", {
		description:
			"Configure workout: /workout [setup | exercise NAME | reps N | camera N | confidence N | upAngle N | downAngle N | holdMs N | reset]",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			if (gateOpen) {
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
				if (input === "setup") {
					if (!dependencies.prepare) throw new Error("Runtime setup is unavailable.");
					gateOpen = true;
					try {
						await ctx.ui
							.custom<GateResult>((tui, theme, keybindings, done) => {
								let message = "Preparing local camera runtime…",
									disposed = false;
								const controller = new AbortController();
								cancelPreparation = () => controller.abort();
								void dependencies
									.prepare?.({
										signal: controller.signal,
										onProgress: (value) => {
											message = value;
											tui.requestRender();
										},
									})
									.then(() => {
										if (!disposed) done({ status: "complete" });
									})
									.catch((error) => {
										if (!disposed)
											done({
												status: controller.signal.aborted ? "cancelled" : "error",
												message: error instanceof Error ? error.message : String(error),
											});
									});
								return {
									render: (width: number) => [
										truncateToWidth(theme.fg("accent", message), width),
										truncateToWidth(`${keybindings.getKeys("app.interrupt").join("/")} cancels setup.`, width),
									],
									handleInput: (data: string) => {
										if (keybindings.matches(data, "app.interrupt") || keybindings.matches(data, "app.clear"))
											controller.abort();
									},
									invalidate: () => {},
									dispose: () => {
										disposed = true;
										controller.abort();
									},
								};
							})
							.then((result) => {
								if (result.status === "error") throw new Error(result.message);
								if (result.status === "complete")
									ctx.ui.notify("Camera setup complete. Ready for your next prompt.", "info");
							});
					} finally {
						gateOpen = false;
						cancelPreparation = undefined;
						cancelPreparation = undefined;
					}
					return;
				}
				if (input.startsWith("setup ")) throw new Error("Use /workout setup. Python is managed automatically.");
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
		if (gateOpen) {
			ctx.ui.notify("A camera gate is already active.", "warning");
			return { action: "handled" };
		}
		let outcome: GateResult = { status: "cancelled" };
		gateOpen = true;
		try {
			outcome = await ctx.ui.custom<GateResult>((tui, theme, keybindings, done) => {
				let count = 0,
					disposed = false;
				let message = "Preparing camera…";
				const controller = new AbortController();
				cancelPreparation = () => controller.abort();
				const finish = (result: GateResult) => {
					if (!disposed) done(result);
				};
				const prepare =
					dependencies.prepare && !process.env.PI_WORKOUT_PYTHON
						? dependencies.prepare({
								signal: controller.signal,
								onProgress: (value) => {
									message = value;
									tui.requestRender();
								},
							})
						: Promise.resolve();
				void prepare
					.then(() => {
						if (disposed || controller.signal.aborted) {
							finish({ status: "cancelled" });
							return;
						}
						active = dependencies.start({ ...settings }, (value) => {
							count = value;
							tui.requestRender();
						});
						message = exercises[settings.exercise].instructions;
						tui.requestRender();
						return active.result.then(finish);
					})
					.catch((error) =>
						finish({
							status: controller.signal.aborted ? "cancelled" : "error",
							message: error instanceof Error ? error.message : String(error),
						}),
					);
				return {
					render: (width: number) => [
						truncateToWidth(
							theme.fg(
								"accent",
								`${exercises[settings.exercise].label} ${count}/${settings.reps} — your prompt is held`,
							),
							width,
						),
						truncateToWidth(message, width),
						truncateToWidth(
							`${keybindings.getKeys("app.interrupt").join("/")} cancels and restores your draft.`,
							width,
						),
					],
					handleInput: (data: string) => {
						if (keybindings.matches(data, "app.interrupt") || keybindings.matches(data, "app.clear")) {
							controller.abort();
							active?.cancel();
						}
					},
					invalidate: () => {},
					dispose: () => {
						disposed = true;
						controller.abort();
						active?.cancel();
					},
				};
			});
		} catch (error) {
			outcome = { status: "error", message: error instanceof Error ? error.message : String(error) };
		} finally {
			active = undefined;
			gateOpen = false;
			cancelPreparation = undefined;
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

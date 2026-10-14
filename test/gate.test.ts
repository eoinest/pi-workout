import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installWorkoutGate } from "../src/gate.ts";
import { defaults, validateSettings } from "../src/settings.ts";
import type { SetupOptions } from "../src/setup.ts";
import { type GateResult, startWorker } from "../src/worker.ts";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function harness(
	outcome: GateResult,
	reps = 1,
	exercise = "pushups",
	prepare?: (options?: SetupOptions) => Promise<void>,
	cancelDuringSetup = false,
) {
	const directory = await mkdtemp(join(tmpdir(), "workout-test-"));
	directories.push(directory);
	const path = join(directory, "settings.json");
	await writeFile(path, JSON.stringify({ ...defaults, reps, exercise }));
	let input: ((event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult>) | undefined;
	const api = {
		on: (name: string, handler: typeof input) => {
			if (name === "input") input = handler;
		},
		registerCommand: vi.fn(),
	} as unknown as ExtensionAPI;
	const cancel = vi.fn();
	const start = vi.fn((_settings: ReturnType<typeof validateSettings>, _progress: (count: number) => void) => ({
		result: Promise.resolve(outcome),
		cancel,
	}));
	installWorkoutGate(api, { settingsPath: path, start, prepare });
	const ui = {
		notify: vi.fn(),
		setStatus: vi.fn(),
		setEditorText: vi.fn(),
		custom: vi.fn(
			async (
				factory: (
					tui: TUI,
					theme: Theme,
					kb: KeybindingsManager,
					done: (result: GateResult) => void,
				) => Component & { dispose?: () => void },
			) => {
				let finish: (result: GateResult) => void = () => {};
				const result = new Promise<GateResult>((resolve) => {
					finish = resolve;
				});
				const component = factory(
					{ requestRender: vi.fn() } as unknown as TUI,
					{ fg: (_color: string, text: string) => text } as unknown as Theme,
					{
						getKeys: () => ["escape"],
						matches: (data: string, action: string) => data === "\x1b" && action === "app.interrupt",
					} as unknown as KeybindingsManager,
					finish,
				);
				expect(component.render(80).length).toBeGreaterThan(0);
				if (cancelDuringSetup) component.handleInput?.("\x1b");
				const value = await result;
				component.dispose?.();
				return value;
			},
		),
	};
	const ctx = { mode: "tui", ui } as unknown as ExtensionContext;
	if (!input) throw new Error("input hook was not registered");
	return { input, ctx, ui, start, api, path };
}
describe("Pi workout input gate", () => {
	it("zero bypasses custom UI and camera", async () => {
		const h = await harness({ status: "complete" }, 0);
		expect(await h.input({ type: "input", text: "draft", source: "interactive" }, h.ctx)).toEqual({
			action: "continue",
		});
		expect(h.ui.custom).not.toHaveBeenCalled();
		expect(h.start).not.toHaveBeenCalled();
	});
	it("completion continues the same input through Pi without injecting a duplicate", async () => {
		const h = await harness({ status: "complete" });
		expect(await h.input({ type: "input", text: "original", source: "interactive" }, h.ctx)).toEqual({
			action: "continue",
		});
		expect(h.ui.custom).toHaveBeenCalledOnce();
		expect(h.start).toHaveBeenCalledOnce();
		expect(h.ui.setEditorText).not.toHaveBeenCalled();
	});
	it.each(["cancelled", "error"] as const)("%s blocks submission and restores exact text", async (status) => {
		const h = await harness({ status, message: "camera unavailable" });
		expect(await h.input({ type: "input", text: "draft\nline two", source: "interactive" }, h.ctx)).toEqual({
			action: "handled",
		});
		expect(h.ui.setEditorText).toHaveBeenCalledWith("draft\nline two");
	});
	it("positive count cannot be bypassed by RPC", async () => {
		const h = await harness({ status: "complete" });
		expect(await h.input({ type: "input", text: "draft", source: "rpc" }, h.ctx)).toEqual({ action: "handled" });
		expect(h.ui.custom).not.toHaveBeenCalled();
	});
	it("programmatic extension messages do not start the gate", async () => {
		const h = await harness({ status: "complete" });
		expect(await h.input({ type: "input", text: "internal", source: "extension" }, h.ctx)).toEqual({
			action: "continue",
		});
		expect(h.ui.custom).not.toHaveBeenCalled();
	});
	it("settings reject invalid counts, cameras, confidence and inverted thresholds", () => {
		for (const value of [
			{ reps: -1 },
			{ reps: 1.5 },
			{ camera: -1 },
			{ confidence: 0 },
			{ downAngle: 170 },
			{ holdMs: 0 },
		])
			expect(() => validateSettings({ ...defaults, ...value })).toThrow();
		expect(validateSettings({ ...defaults, reps: 0 }).reps).toBe(0);
	});
});

describe("native worker protocol", () => {
	async function executable(source: string) {
		const directory = await mkdtemp(join(tmpdir(), "workout-worker-"));
		directories.push(directory);
		const path = join(directory, "helper");
		await writeFile(path, `#!${process.execPath}\n${source}\n`);
		await chmod(path, 0o755);
		return path;
	}
	it("waits for helper exit and required reps before accepting completion", async () => {
		const binary = await executable(`process.stdout.write('{"type":"progress","count":1}\\n{"type":"complete"}\\n');`);
		vi.stubEnv("PI_WORKOUT_PYTHON", binary);
		try {
			const progress = vi.fn();
			const worker = startWorker({ ...defaults }, progress);
			expect(await worker.result).toEqual({ status: "complete" });
			expect(progress).toHaveBeenCalledWith(1);
			worker.cancel();
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("rejects a premature completion record", async () => {
		const binary = await executable(`process.stdout.write('{"type":"complete"}\\n');`);
		vi.stubEnv("PI_WORKOUT_PYTHON", binary);
		try {
			expect((await startWorker({ ...defaults }, () => {}).result).status).toBe("error");
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("cancellation terminates a live helper and blocks late success", async () => {
		const binary = await executable("setInterval(()=>{},1000);");
		vi.stubEnv("PI_WORKOUT_PYTHON", binary);
		try {
			const worker = startWorker({ ...defaults }, () => {});
			worker.cancel();
			worker.cancel();
			expect(await worker.result).toEqual({ status: "cancelled" });
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("a missing interpreter fails closed", async () => {
		vi.stubEnv("PI_WORKOUT_PYTHON", "/nonexistent/pushups/python");
		try {
			expect((await startWorker({ ...defaults }, () => {}).result).status).toBe("error");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe("exercise selection", () => {
	it.each(["curls", "pullups", "pushups", "squats", "situps"])("passes %s to the camera worker", async (exercise) => {
		const h = await harness({ status: "complete" }, 1, exercise);
		await h.input({ type: "input", text: "draft", source: "interactive" }, h.ctx);
		expect(h.start.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ exercise }));
	});
	it("changing exercise persists it and resets its angle defaults", async () => {
		const h = await harness({ status: "complete" });
		const command = h.api.registerCommand as unknown as ReturnType<typeof vi.fn>;
		const registration = command.mock.calls[0][1] as {
			handler: (args: string, ctx: ExtensionContext) => Promise<void>;
		};
		await registration.handler("exercise curls", h.ctx);
		const settings = JSON.parse(await readFile(h.path, "utf8"));
		expect(settings).toEqual(expect.objectContaining({ exercise: "curls", upAngle: 155, downAngle: 65 }));
	});
	it("an unknown exercise is rejected without modifying saved settings", async () => {
		const h = await harness({ status: "complete" });
		const command = h.api.registerCommand as unknown as ReturnType<typeof vi.fn>;
		const registration = command.mock.calls[0][1] as {
			handler: (args: string, ctx: ExtensionContext) => Promise<void>;
		};
		await registration.handler("exercise unknown", h.ctx);
		expect(JSON.parse(await readFile(h.path, "utf8")).exercise).toBe("pushups");
		expect(h.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Unknown exercise"), "error");
	});
});

describe("automatic local setup", () => {
	it("prepares before opening the camera on the first gated prompt", async () => {
		const order: string[] = [];
		const prepare = vi.fn(async () => {
			order.push("setup");
		});
		const h = await harness({ status: "complete" }, 1, "pushups", prepare);
		h.start.mockImplementation(() => {
			order.push("camera");
			return { result: Promise.resolve({ status: "complete" }), cancel: vi.fn() };
		});
		expect(await h.input({ type: "input", text: "draft", source: "interactive" }, h.ctx)).toEqual({
			action: "continue",
		});
		expect(order).toEqual(["setup", "camera"]);
	});
	it("zero reps does not download or prepare a runtime", async () => {
		const prepare = vi.fn(async () => {});
		const h = await harness({ status: "complete" }, 0, "pushups", prepare);
		await h.input({ type: "input", text: "draft", source: "interactive" }, h.ctx);
		expect(prepare).not.toHaveBeenCalled();
	});
	it("reports setup errors and restores the draft without starting a camera", async () => {
		const prepare = vi.fn(async () => {
			throw new Error("Runtime download failed: HTTP 503.");
		});
		const h = await harness({ status: "complete" }, 1, "pushups", prepare);
		expect(await h.input({ type: "input", text: "unchanged draft", source: "interactive" }, h.ctx)).toEqual({
			action: "handled",
		});
		expect(h.start).not.toHaveBeenCalled();
		expect(h.ui.setEditorText).toHaveBeenCalledWith("unchanged draft");
		expect(h.ui.notify).toHaveBeenCalledWith(expect.stringContaining("HTTP 503"), "error");
	});
	it("Escape cancels preparation and restores the draft", async () => {
		const prepare = vi.fn(
			(options?: SetupOptions) =>
				new Promise<void>((_resolve, reject) => {
					options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
				}),
		);
		const h = await harness({ status: "complete" }, 1, "pushups", prepare, true);
		expect(await h.input({ type: "input", text: "cancelled draft", source: "interactive" }, h.ctx)).toEqual({
			action: "handled",
		});
		expect(h.start).not.toHaveBeenCalled();
		expect(h.ui.setEditorText).toHaveBeenCalledWith("cancelled draft");
	});
	it("the bare setup command uses built-in preparation with no interpreter argument", async () => {
		const prepare = vi.fn(async () => {});
		const h = await harness({ status: "complete" }, 1, "pushups", prepare);
		const command = h.api.registerCommand as unknown as ReturnType<typeof vi.fn>;
		const registration = command.mock.calls[0][1] as {
			handler: (args: string, ctx: ExtensionContext) => Promise<void>;
		};
		await registration.handler("setup", h.ctx);
		expect(prepare).toHaveBeenCalledOnce();
		expect(h.start).not.toHaveBeenCalled();
		expect(h.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Camera setup complete"), "info");
	});
});

it("forwards camera startup status while preserving progress and completion", async () => {
	const directory = await mkdtemp(join(tmpdir(), "workout-camera-status-"));
	directories.push(directory);
	const binary = join(directory, "helper");
	await writeFile(
		binary,
		`#!${process.execPath}\nprocess.stdout.write('${JSON.stringify({ type: "status", message: "Camera ready: MacBook Pro Camera" })}\\n${JSON.stringify({ type: "progress", count: 1 })}\\n${JSON.stringify({ type: "complete" })}\\n');\n`,
	);
	await chmod(binary, 0o755);
	vi.stubEnv("PI_WORKOUT_PYTHON", binary);
	try {
		const status = vi.fn();
		const worker = startWorker({ ...defaults }, () => {}, status);
		expect(await worker.result).toEqual({ status: "complete" });
		expect(status).toHaveBeenCalledWith("Camera ready: MacBook Pro Camera");
	} finally {
		vi.unstubAllEnvs();
	}
});

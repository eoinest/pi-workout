import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { listCameras } from "../src/cameras.ts";
import { installWorkoutGate } from "../src/gate.ts";
import { getRuntimeDirectory } from "../src/runtime.ts";
import { ensureRuntime } from "../src/setup.ts";
import { startWorker } from "../src/worker.ts";

export default function workout(pi: ExtensionAPI): void {
	installWorkoutGate(pi, {
		settingsPath: process.env.PI_WORKOUT_SETTINGS || join(getRuntimeDirectory(), "settings.json"),
		start: startWorker,
		prepare: ensureRuntime,
		listCameras,
	});
}

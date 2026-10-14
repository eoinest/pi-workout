import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRuntimeDirectory } from "./runtime.ts";
import { runCommand } from "./setup.ts";

export async function listCameras(): Promise<string> {
	const python =
		process.env.PI_WORKOUT_PYTHON ||
		join(getRuntimeDirectory(), process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
	const result = JSON.parse(
		await runCommand(python, [fileURLToPath(new URL("../native/camera.py", import.meta.url)), "--list-cameras"]),
	) as { devices?: { index: number; name: string; builtIn?: boolean; continuity?: boolean }[]; message?: string };
	if (!Array.isArray(result.devices)) throw new Error("Invalid camera listing from native helper.");
	if (!result.devices.length) return result.message || "No cameras found by macOS.";
	return result.devices
		.map(
			(device) =>
				`${device.index}: ${device.name}${device.builtIn ? " (built-in)" : device.continuity ? " (Continuity Camera)" : ""}`,
		)
		.join("\n");
}

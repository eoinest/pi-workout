import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function getRuntimeDirectory(): string {
	return process.env.PI_WORKOUT_DATA_DIR || join(getAgentDir(), "pi-workout");
}

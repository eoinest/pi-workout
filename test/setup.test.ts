import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCommand, runtimeReady, verifyHash } from "../src/setup.ts";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function script(source: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "workout-setup-"));
	directories.push(directory);
	const path = join(directory, "helper.mjs");
	await writeFile(path, source);
	return path;
}
it("rejects corrupted downloads before extraction", () => {
	const bytes = Buffer.from("verified archive");
	const expected = createHash("sha256").update(bytes).digest("hex");
	expect(() => verifyHash(bytes, expected, "Runtime manager")).not.toThrow();
	expect(() => verifyHash(Buffer.from("corrupted"), expected, "Runtime manager")).toThrow("checksum mismatch");
});
it("preserves useful errors emitted on stdout when stderr is empty", async () => {
	const path = await script("console.log('Missing camera wheel');process.exit(1);");
	await expect(runCommand(process.execPath, [path])).rejects.toThrow("Missing camera wheel");
});
it("reports missing executables instead of an empty setup failure", async () => {
	await expect(runCommand("/nonexistent/workout-command", [])).rejects.toThrow("Could not run");
});
it("an aborted setup command does not start a subprocess", async () => {
	const controller = new AbortController();
	controller.abort(new Error("Cancelled setup"));
	await expect(runCommand(process.execPath, [], { signal: controller.signal })).rejects.toThrow("Cancelled setup");
});
it("a corrupted cached model requires repair", async () => {
	const directory = await mkdtemp(join(tmpdir(), "workout-bad-model-"));
	directories.push(directory);
	await writeFile(join(directory, "pose_landmarker_lite.task"), "corrupted");
	expect(await runtimeReady(directory)).toBe(false);
});

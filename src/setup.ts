import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRuntimeDirectory } from "./runtime.ts";

const UV_VERSION = "0.13.0";
const MODEL_URL =
	"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export const MODEL_HASH = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a";
const uvAssets: Record<string, { archive: string; hash: string }> = {
	"darwin-arm64": {
		archive: "uv-aarch64-apple-darwin.tar.gz",
		hash: "a9c1b29002cf3c83f07fa9cd8a887a3be0107d90e23189721221e7257db8e3d6",
	},
	"darwin-x64": {
		archive: "uv-x86_64-apple-darwin.tar.gz",
		hash: "5f44dcbde809b632f47c36fadb241cb4d6f9af71d0c8f172b5d2026d3dde742c",
	},
	"linux-arm64": {
		archive: "uv-aarch64-unknown-linux-gnu.tar.gz",
		hash: "3ccfb6af6e242433eb552f7d9676abd5412c6595c497e990d9c8cb7b5bd4d2c3",
	},
	"linux-x64": {
		archive: "uv-x86_64-unknown-linux-gnu.tar.gz",
		hash: "1468ebd5a5541121837c5a2817b9972ba6090fa6caa3d142620850a47fb75154",
	},
	"win32-arm64": {
		archive: "uv-aarch64-pc-windows-msvc.zip",
		hash: "cb54028b59aa87f11cf6dec293ce000420043a49a8aea522e822a671321f8932",
	},
	"win32-x64": {
		archive: "uv-x86_64-pc-windows-msvc.zip",
		hash: "088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c",
	},
};
export interface SetupOptions {
	directory?: string;
	signal?: AbortSignal;
	onProgress?: (message: string) => void;
}
interface CommandOptions {
	signal?: AbortSignal;
	env?: NodeJS.ProcessEnv;
	timeout?: number;
}

export function verifyHash(bytes: Uint8Array, expected: string, label: string): void {
	if (createHash("sha256").update(bytes).digest("hex") !== expected)
		throw new Error(`${label} checksum mismatch. Download discarded.`);
}

export async function runCommand(binary: string, args: string[], options: CommandOptions = {}): Promise<string> {
	const timeout = AbortSignal.timeout(options.timeout ?? 300000);
	const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], env: options.env || process.env, signal });
		let stdout = "",
			stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout = (stdout + chunk).slice(-65536);
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-65536);
		});
		child.once("error", (error) => reject(new Error(`Could not run ${binary}: ${error.message}`)));
		child.once("close", (code) => {
			if (signal.aborted) {
				reject(signal.reason);
				return;
			}
			if (code !== 0) {
				reject(new Error((stderr.trim() || stdout.trim() || `Process exited with code ${code}`).slice(-2000)));
				return;
			}
			resolve(stdout.trim());
		});
	});
}

async function download(url: string, expected: string, label: string, signal?: AbortSignal): Promise<Buffer> {
	const response = await fetch(url, {
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
	});
	if (!response.ok) throw new Error(`${label} download failed: HTTP ${response.status}.`);
	const bytes = Buffer.from(await response.arrayBuffer());
	verifyHash(bytes, expected, label);
	return bytes;
}

async function installUv(directory: string, signal?: AbortSignal): Promise<string> {
	const asset = uvAssets[`${process.platform}-${process.arch}`];
	if (!asset) throw new Error(`Automatic setup does not support ${process.platform}/${process.arch}.`);
	const tools = join(directory, "tools", `uv-${UV_VERSION}`);
	const binary = join(tools, process.platform === "win32" ? "uv.exe" : "uv");
	if (existsSync(binary)) {
		try {
			if ((await runCommand(binary, ["--version"], { signal })).startsWith(`uv ${UV_VERSION} `)) return binary;
		} catch {
			signal?.throwIfAborted();
		}
	}
	await mkdir(tools, { recursive: true });
	const staging = join(tools, `.download-${randomUUID()}`);
	await mkdir(staging);
	try {
		const archive = join(staging, asset.archive);
		const bytes = await download(
			`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset.archive}`,
			asset.hash,
			"Runtime manager",
			signal,
		);
		await writeFile(archive, bytes);
		const extracted = join(staging, "extracted");
		await mkdir(extracted);
		if (process.platform === "win32") {
			await runCommand(
				"powershell.exe",
				[
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					"Expand-Archive -LiteralPath $env:PI_WORKOUT_ARCHIVE -DestinationPath $env:PI_WORKOUT_EXTRACT",
				],
				{ signal, env: { ...process.env, PI_WORKOUT_ARCHIVE: archive, PI_WORKOUT_EXTRACT: extracted } },
			);
		} else await runCommand("/usr/bin/tar", ["-xzf", archive, "-C", extracted], { signal });
		const name = process.platform === "win32" ? "uv.exe" : "uv";
		let source = join(extracted, name);
		if (!existsSync(source)) {
			const entries = await readdir(extracted, { withFileTypes: true });
			const parent = entries.find((entry) => entry.isDirectory() && existsSync(join(extracted, entry.name, name)));
			if (!parent) throw new Error("Verified runtime archive did not contain uv.");
			source = join(extracted, parent.name, name);
		}
		await copyFile(source, binary);
		if (process.platform !== "win32") await chmod(binary, 0o755);
		return binary;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

function runtimePython(directory: string): string {
	return join(directory, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
}

async function pythonHealthy(directory: string, signal?: AbortSignal): Promise<boolean> {
	const python = runtimePython(directory);
	if (!existsSync(python)) return false;
	try {
		await runCommand(python, [fileURLToPath(new URL("../native/healthcheck.py", import.meta.url))], {
			signal,
			timeout: 60000,
		});
		return true;
	} catch {
		signal?.throwIfAborted();
		return false;
	}
}

export async function runtimeReady(directory = getRuntimeDirectory(), signal?: AbortSignal): Promise<boolean> {
	const model = join(directory, "pose_landmarker_lite.task");
	if (!existsSync(model)) return false;
	try {
		verifyHash(await readFile(model), MODEL_HASH, "Pose model");
	} catch {
		return false;
	}
	return pythonHealthy(directory, signal);
}

export async function ensureRuntime(options: SetupOptions = {}): Promise<void> {
	const directory = options.directory || getRuntimeDirectory();
	const signal = options.signal;
	const progress = options.onProgress || (() => {});
	signal?.throwIfAborted();
	if (await runtimeReady(directory, signal)) {
		progress("Camera runtime ready.");
		return;
	}
	await mkdir(directory, { recursive: true });
	progress("Preparing the local runtime manager…");
	const uv = await installUv(directory, signal);
	const env = {
		...process.env,
		UV_CACHE_DIR: join(directory, "cache"),
		UV_PYTHON_INSTALL_DIR: join(directory, "python"),
		UV_PYTHON_DOWNLOADS: "automatic",
		UV_NO_CONFIG: "1",
		UV_PYTHON_INSTALL_BIN: "0",
		UV_PYTHON_NO_REGISTRY: "1",
	};
	if (!(await pythonHealthy(directory, signal))) {
		// Only the plugin-owned environment is replaced; system Python is untouched.
		await rm(join(directory, ".venv"), { recursive: true, force: true });
		progress("Installing private Python 3.12…");
		await runCommand(uv, ["venv", "--managed-python", "--python", "3.12", join(directory, ".venv")], { signal, env });
	}
	progress("Installing camera and pose-tracking packages…");
	await runCommand(
		uv,
		[
			"pip",
			"install",
			"--python",
			runtimePython(directory),
			"--only-binary",
			":all:",
			"--default-index",
			"https://pypi.org/simple",
			"--requirements",
			fileURLToPath(new URL("../native/requirements.txt", import.meta.url)),
		],
		{ signal, env },
	);
	progress("Downloading and verifying the pose model…");
	const model = await download(MODEL_URL, MODEL_HASH, "Pose model", signal);
	const temporary = join(directory, `.model-${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, model);
		signal?.throwIfAborted();
		await rename(temporary, join(directory, "pose_landmarker_lite.task"));
	} finally {
		await rm(temporary, { force: true });
	}
	progress("Checking the local camera runtime…");
	await runCommand(runtimePython(directory), [fileURLToPath(new URL("../native/healthcheck.py", import.meta.url))], {
		signal,
	});
	progress("Camera runtime ready.");
}

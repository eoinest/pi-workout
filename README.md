# pi-workout

sharpen your mind and your body

A standalone [Pi](https://github.com/earendil-works/pi) extension that gates prompts behind a configurable workout. It uses your existing Pi TUI and a native camera preview with body tracking. Supports curls, pull-ups, push-ups, squats, and sit-ups. The camera, settings, and prompt gate are independent of each exercise counter.

## Install

With Pi installed:

```sh
pi install git:github.com/eoinest/pi-workout
pi
```

Just start using Pi. Your first positive-count submission automatically prepares the local camera runtime, then opens the preview. You can also run `/workout setup` inside Pi to prepare it ahead of time. No system Python installation, interpreter path, or external script command is required. The plugin downloads a pinned, checksum-verified uv binary, provisions a private Python 3.12 environment, installs the camera dependencies, and verifies the pose model. Escape cancels setup without sending your prompt. Setup never accesses the camera. Select your provider/model with Pi's usual commands. Initial setup needs network access; subsequent use is local.

For a local checkout or one-session trial:

```sh
git clone https://github.com/eoinest/pi-workout.git ~/Documents/dev/pi-workout
pi -e ~/Documents/dev/pi-workout/extensions/index.ts
```

The local launcher `./pi-workout.sh` uses an installed Pi, or the development copy after `npm install --ignore-scripts --legacy-peer-deps`. The launcher preserves your working directory. If a development runtime exists in `.local/`, the launcher uses it unless `PI_WORKOUT_DATA_DIR` is set. The package carries no forked Pi runtime and makes no changes to Pi core.

## Use

Type in Pi's existing editor and submit. The extension holds that prompt and opens a native camera window with a skeleton overlay and rep counter. Finishing the required repetitions releases the same prompt through Pi's normal input pipeline. Escape in the preview or Pi's terminal closes the gate and restores the text draft. A target of zero sends immediately without camera access.

All workout settings are available in the TUI:

- `/workout` opens the settings selector.
- `/workout exercise pushups` selects push-ups; also accepts `curls`, `pullups`, `squats`, and `situps`. Switching exercises loads its default angle thresholds.
- `/workout reps 3` or `/workout 3` requires three repetitions.
- `/workout 0` disables the gate.
- `/workout camera 1` selects a camera index (default 0).
- `/workout confidence 0.65` sets minimum landmark confidence.
- `/workout upAngle 155`, `/workout downAngle 100`, and `/workout holdMs 180` adjust the selected counter's thresholds. `upAngle` is the extended starting position; `downAngle` is the contracted position.
- `/workout reset` restores defaults: one push-up per prompt.

Settings, the native environment, and model live under Pi's agent directory in `pi-workout/` (normally `~/.pi/agent/pi-workout`). They survive plugin checkout replacement and upgrades. `PI_WORKOUT_DATA_DIR` overrides that directory, `PI_WORKOUT_SETTINGS` overrides the settings file, and `PI_WORKOUT_PYTHON` selects an existing compatible interpreter. The footer shows the current exercise and target. Pi's configured `app.interrupt` and `app.clear` keys cancel the terminal gate; default interrupt is Escape.

## Structure and adding exercises

```text
extensions/index.ts           Pi package entry point
src/gate.ts                   input interception, TUI commands, draft restoration
src/settings.ts               shared configuration and validation
src/runtime.ts                persistent runtime paths
src/worker.ts                 native helper process and cancellation protocol
src/exercises.ts              exercise catalog and setup instructions
native/camera.py              shared camera, MediaPipe, skeleton overlay
native/exercises/__init__.py   native exercise registry
native/exercises/common.py     shared stable full-cycle state machine
native/exercises/{curls,pullups,pushups,squats,situps}.py  per-exercise geometry
src/setup.ts                  automatic private Python, dependencies, and verified model
native/healthcheck.py          validates the runtime without opening the camera
test/                         Pi gate and subprocess tests
native/test_counter.py        synthetic pose tests
```

To add another workout, add its definition in `src/exercises.ts`, implement a counter under `native/exercises/`, and register it in `native/exercises/__init__.py`. A counter extends `CycleCounter` and defines `measure_pose(points)` and `guidance(tracking)`. The shared camera module supplies pose landmarks corrected for frame aspect ratio. Add exercise-specific tests for valid cycles, stationary holds, noise, and lost tracking. No prompt gate or camera ownership changes are required. Each exercise definition supplies default starting and contracted angles. Add exercise-specific settings when new counters need more than these shared thresholds.

## Tracking and privacy

MediaPipe Pose Landmarker runs locally through Python, and OpenCV displays the native preview. No browser, web server, or replacement chat UI is involved. Frames and pose data are neither recorded nor sent to Pi's provider. Camera access starts only after a positive-count submission. Closing the preview, cancelling, errors, timeout, or session shutdown releases it. On macOS the camera permission may be attributed to Terminal or Python because Pi launches the helper.

Position the camera side-on in good lighting. Each rep needs a stable starting pose, a contracted pose, and a return to the start:

| Exercise | Cycle | Default angles | Camera framing |
| --- | --- | --- | --- |
| Curls | Straight arm → curl → straight arm | Elbow 155° / 65° | Shoulder, elbow, wrist, and hip; upper arm at your side |
| Pull-ups | Straight-arm hang → pull up → straight-arm hang | Elbow 155° / 80° | Hands overhead, elbows, shoulders, and hips |
| Push-ups | Straight-arm plank → lower → straight-arm plank | Elbow 155° / 100° | Full body side-on, straight hips and knees |
| Squats | Stand → squat → stand | Knee 160° / 100° | Shoulders, hips, knees, and ankles |
| Sit-ups | Lie back → sit up → lie back | Hip-to-ankle 150° / 100° | Full body side-on with bent knees and planted feet |

Curls count one visible arm's complete cycle. Pull-ups estimate elbow motion with hands overhead; monocular pose landmarks cannot prove that you're hanging from a bar or clear the bar with your chin. Sit-ups require bent knees and similar hip/foot height to distinguish them from standing bends. These are approximate movement counters, not verified exercise-form scoring.

For push-ups, counting requires a roughly horizontal torso, straight hips and knees, hands below shoulders, and a stable straight-arm → lowered → straight-arm cycle. Tracking lost for over 700ms resets the cycle. Knee push-ups are not currently supported. Camera placement, visibility, and body proportions affect recognition; this counts approximate reps rather than assessing exercise form. Cancelled attempts discard partial reps. Text is restored exactly; attached images must be reattached after cancellation.

Slash commands remain normal Pi commands. Positive-count noninteractive user prompts are blocked, since they cannot show the native gate. Zero-count mode passes through. Programmatic messages from other extensions pass through. This is a personal workflow gate, not an anti-cheating boundary.

## Development and verification

Tested against Pi 1.2.0 using its public extension APIs. Pi host packages are peer dependencies; development installs are not included in the distributed plugin.

```sh
npm install --ignore-scripts --legacy-peer-deps
npm run check
npm test
python3 -m unittest discover -s native -p 'test_*.py'
npm pack --dry-run
```

Tests exercise zero-count bypass, completion, exact draft restoration, worker failures/cancellation, settings validation, and rep geometry without using a camera or paid model calls. Live camera accuracy still needs validation with your physical setup. Native setup uses uv 0.13.0 from the official Astral release (pinned SHA-256 per platform), managed Python 3.12, pinned MediaPipe/OpenCV PyPI wheels, and a versioned model checked against its SHA-256 hash. Python, uv, its cache, and the environment all stay in the plugin data directory; setup does not install into or alter system Python.

## License

MIT. The existing [eoinest/pushup-pi](https://github.com/eoinest/pushup-pi) fork remains a separate project. This repository contains only the plugin, native helper, and tests. MediaPipe and OpenCV use Apache-2.0; preserve their notices when redistributing. [Official MediaPipe Python guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python).

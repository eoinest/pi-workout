export interface ExerciseDefinition {
	id: string;
	label: string;
	instructions: string;
	angles: { upAngle: number; downAngle: number };
}
export const exercises: Readonly<Record<string, ExerciseDefinition>> = {
	curls: {
		id: "curls",
		label: "Curls",
		instructions: "Face side-on, keep your torso upright and upper arm at your side. Extend, curl, then lower.",
		angles: { upAngle: 155, downAngle: 65 },
	},
	pullups: {
		id: "pullups",
		label: "Pull-ups",
		instructions: "Keep your full body and bar in frame. Start hanging with straight arms, pull up, then lower.",
		angles: { upAngle: 155, downAngle: 80 },
	},
	pushups: {
		id: "pushups",
		label: "Push-ups",
		instructions: "Place your full body side-on. Start in a straight-arm plank, lower, then push up.",
		angles: { upAngle: 155, downAngle: 100 },
	},
	squats: {
		id: "squats",
		label: "Squats",
		instructions: "Stand side-on with hips, knees and ankles visible. Stand tall, squat, then stand.",
		angles: { upAngle: 160, downAngle: 100 },
	},
	situps: {
		id: "situps",
		label: "Sit-ups",
		instructions: "Lie side-on with knees bent and feet planted. Lie back, sit up, then lie back.",
		angles: { upAngle: 150, downAngle: 100 },
	},
};

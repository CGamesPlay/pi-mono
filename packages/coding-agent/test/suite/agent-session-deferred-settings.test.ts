import { fauxAssistantMessage } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

describe("AgentSession deferred model/thinking-level settings", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("does not write model_change entries during cycling — only the final model on prompt", async () => {
		const harness = await createHarness({
			models: [
				{ id: "faux-1", name: "One", reasoning: true },
				{ id: "faux-2", name: "Two", reasoning: true },
				{ id: "faux-3", name: "Three", reasoning: true },
			],
		});
		harnesses.push(harness);

		// Cycle twice — should produce zero model_change entries
		await harness.session.cycleModel(); // faux-1 -> faux-2
		await harness.session.cycleModel(); // faux-2 -> faux-3

		expect(harness.sessionManager.getEntries().filter((e) => e.type === "model_change")).toHaveLength(0);

		// Prompt writes exactly one model_change for the final model
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("go");

		const modelChanges = harness.sessionManager.getEntries().filter((e) => e.type === "model_change");

		expect(modelChanges).toHaveLength(1);
		expect(modelChanges[0]!.provider).toBe("faux");
		expect(modelChanges[0]!.modelId).toBe("faux-3");
	});

	it("does not write thinking_level_change entries during cycling — only the final level on prompt", async () => {
		const harness = await createHarness({
			models: [{ id: "faux-1", name: "One", reasoning: true }],
		});
		harnesses.push(harness);

		// Cycle thinking levels — should produce zero entries
		harness.session.cycleThinkingLevel(); // off -> minimal
		harness.session.cycleThinkingLevel(); // minimal -> low

		expect(harness.sessionManager.getEntries().filter((e) => e.type === "thinking_level_change")).toHaveLength(0);

		// Prompt writes exactly one thinking_level_change
		harness.setResponses([fauxAssistantMessage("ok")]);
		await harness.session.prompt("go");

		const tlChanges = harness.sessionManager.getEntries().filter((e) => e.type === "thinking_level_change");

		expect(tlChanges).toHaveLength(1);
		expect(tlChanges[0]!.thinkingLevel).toBe("low");
	});

	it("writes no model_change when the model hasn't changed from the session tree", async () => {
		const harness = await createHarness({
			models: [{ id: "faux-1", name: "One", reasoning: true }],
		});
		harnesses.push(harness);

		// No cycling — model stays as faux-1 the whole time
		// First prompt writes one model_change (initial model, no prior context.model)
		harness.setResponses([fauxAssistantMessage("first")]);
		await harness.session.prompt("turn 1");

		const countAfterFirst = harness.sessionManager.getEntries().filter((e) => e.type === "model_change").length;

		// Second prompt: assistant message carries faux/faux-1, current model is faux/faux-1 → no new entry
		harness.setResponses([fauxAssistantMessage("second")]);
		await harness.session.prompt("turn 2");

		const countAfterSecond = harness.sessionManager.getEntries().filter((e) => e.type === "model_change").length;

		expect(countAfterSecond).toBe(countAfterFirst);
	});
});

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.js";

describe("runWhenIdle primitive", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("does not fire while a turn is streaming, fires after the turn ends", async () => {
		let extensionApi: ExtensionAPI | undefined;
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});
		const observations: string[] = [];
		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for the test to release execution",
			parameters: Type.Object({}),
			execute: async () => {
				// Schedule the idle callback while the agent is busy with this tool call.
				extensionApi?.runWhenIdle(() => {
					observations.push("idle-fired");
				});
				observations.push("tool-running");
				await toolRelease;
				return {
					content: [{ type: "text", text: "released" }],
					details: {},
				};
			},
		};
		const harness = await createHarness({
			tools: [waitTool],
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("turn complete"),
		]);

		const sawToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.toolName === "wait") {
					unsubscribe();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("start");
		await sawToolStart;
		// Yield once so the tool body runs and registers the callback.
		await new Promise((resolve) => setTimeout(resolve, 0));
		// At this point the callback has been registered but the agent is
		// still streaming. The callback must not have fired yet.
		expect(observations).toEqual(["tool-running"]);

		releaseToolExecution?.();
		await promptPromise;
		// Wait one more macrotask so the idle drain queued onto the event
		// queue has a chance to settle.
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(observations).toEqual(["tool-running", "idle-fired"]);
	});

	it("fires registered callbacks in order, one at a time", async () => {
		let extensionApi: ExtensionAPI | undefined;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("done")]);

		const order: string[] = [];
		extensionApi?.runWhenIdle(() => {
			order.push("a");
		});
		extensionApi?.runWhenIdle(() => {
			order.push("b");
		});
		extensionApi?.runWhenIdle(() => {
			order.push("c");
		});

		// We're idle right now (no turn started); the callbacks should
		// drain on the next microtask cycle.
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(order).toEqual(["a", "b", "c"]);
	});

	it("provides a context with the same surface as a slash-command handler", async () => {
		let extensionApi: ExtensionAPI | undefined;
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});
		harnesses.push(harness);

		let observed: ExtensionCommandContext | undefined;
		extensionApi?.runWhenIdle((ctx) => {
			observed = ctx;
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(observed).toBeDefined();
		// ExtensionCommandContext-only methods that aren't on the base
		// ExtensionContext.
		expect(typeof observed?.waitForIdle).toBe("function");
		expect(typeof observed?.newSession).toBe("function");
		expect(typeof observed?.fork).toBe("function");
		expect(typeof observed?.navigateTree).toBe("function");
		expect(typeof observed?.switchSession).toBe("function");
		expect(typeof observed?.reload).toBe("function");
	});

	it("routes callback errors to the extension error listener and continues with the next callback", async () => {
		let extensionApi: ExtensionAPI | undefined;
		const errors: Array<{ event: string; error: string }> = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({
			onError: (err) => {
				errors.push({ event: err.event, error: err.error });
			},
		});

		const order: string[] = [];
		extensionApi?.runWhenIdle(() => {
			order.push("first");
			throw new Error("boom");
		});
		extensionApi?.runWhenIdle(() => {
			order.push("second");
		});

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(order).toEqual(["first", "second"]);
		expect(errors.map((e) => e.event)).toContain("runWhenIdle");
		expect(errors.find((e) => e.event === "runWhenIdle")?.error).toContain("boom");
	});

	it("drops pending callbacks on reload so closures bound to the prior runtime do not fire", async () => {
		let extensionApi: ExtensionAPI | undefined;
		let releaseToolExecution: (() => void) | undefined;
		const toolRelease = new Promise<void>((resolve) => {
			releaseToolExecution = resolve;
		});
		const observations: string[] = [];
		const waitTool: AgentTool = {
			name: "wait",
			label: "Wait",
			description: "Wait for the test to release execution",
			parameters: Type.Object({}),
			execute: async () => {
				// Register the callback while the agent is busy. The
				// callback cannot run yet (session is streaming).
				extensionApi?.runWhenIdle(() => {
					observations.push("idle-fired");
				});
				await toolRelease;
				return { content: [{ type: "text", text: "released" }], details: {} };
			},
		};

		const harness = await createHarness({
			tools: [waitTool],
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("turn complete"),
		]);

		const sawToolStart = new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.toolName === "wait") {
					unsubscribe();
					resolve();
				}
			});
		});

		const promptPromise = harness.session.prompt("start");
		await sawToolStart;
		await new Promise((resolve) => setTimeout(resolve, 0));
		// Callback is registered but session is still streaming.
		// Trigger reload — this should drop the queued callback.
		await harness.session.reload();
		releaseToolExecution?.();
		await promptPromise;
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(observations).toEqual([]);
	});
});

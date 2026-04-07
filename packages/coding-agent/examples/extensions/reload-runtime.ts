/**
 * Reload Runtime Extension
 *
 * Demonstrates ctx.reload() from ExtensionCommandContext and an LLM-callable
 * tool that uses pi.runWhenIdle() to schedule a reload after the current
 * turn completes.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
	// Command entrypoint for reload.
	// Treat reload as terminal for this handler.
	pi.registerCommand("reload-runtime", {
		description: "Reload extensions, skills, prompts, and themes",
		handler: async (_args, ctx) => {
			await ctx.reload();
			return;
		},
	});

	// LLM-callable tool. Tools get ExtensionContext, which doesn't expose
	// session-mutating actions like reload() — those are only safe once
	// the session is idle. pi.runWhenIdle() defers a callback until the
	// session reaches that state and provides an ExtensionCommandContext
	// to the callback.
	pi.registerTool({
		name: "reload_runtime",
		label: "Reload Runtime",
		description: "Reload extensions, skills, prompts, and themes",
		parameters: Type.Object({}),
		async execute() {
			pi.runWhenIdle(async (ctx) => {
				await ctx.reload();
			});
			return {
				content: [{ type: "text", text: "Reload scheduled for when the session is idle." }],
				details: {},
			};
		},
	});
}

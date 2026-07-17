import { expect, it, vi } from "bun:test";
import { parseArgs } from "@gajae-code/coding-agent/cli/args";
import {
	createComputerBrokerControllerFromEnvironment,
	GJC_COMPUTER_BROKER_DIR_ENV,
	GJC_COMPUTER_BROKER_REQUIRED_ENV,
	GJC_COMPUTER_BROKER_SOCKET_ENV,
	GJC_COMPUTER_BROKER_TOKEN_ENV,
} from "@gajae-code/coding-agent/gjc-runtime/computer-broker";
import { runRootCommand } from "@gajae-code/coding-agent/main";
import { logger } from "@gajae-code/utils";

it("acquires the managed computer broker lease before root-command routing", async () => {
	const events: string[] = [];
	await runRootCommand(parseArgs(["--resume"]), [], {
		acquireComputerBrokerLease: async () => {
			events.push("acquire");
		},
		isResumePickerTerminal: () => {
			events.push("route");
			return false;
		},
		suppressProcessExit: true,
	});
	expect(events).toEqual(["acquire", "route"]);
});

it("continues root routing after an expected broker acquisition failure while computer use remains fail closed", async () => {
	const brokerEnvironment = [
		GJC_COMPUTER_BROKER_SOCKET_ENV,
		GJC_COMPUTER_BROKER_TOKEN_ENV,
		GJC_COMPUTER_BROKER_DIR_ENV,
		GJC_COMPUTER_BROKER_REQUIRED_ENV,
	] as const;
	const previousEnvironment = new Map(brokerEnvironment.map(key => [key, process.env[key]]));
	const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
	const events: string[] = [];
	const secret = "broker-token-must-not-be-logged";

	try {
		for (const key of brokerEnvironment) delete process.env[key];
		process.env[GJC_COMPUTER_BROKER_REQUIRED_ENV] = "1";
		await runRootCommand(parseArgs(["--resume"]), [], {
			acquireComputerBrokerLease: async () => {
				events.push("acquire");
				throw Object.assign(new Error(secret), { code: "COMPUTER_BROKER_UNAVAILABLE" });
			},
			isResumePickerTerminal: () => {
				events.push("route");
				return false;
			},
			suppressProcessExit: true,
		});

		expect(events).toEqual(["acquire", "route"]);
		expect(warning).toHaveBeenCalledWith("Managed computer broker unavailable; computer actions will fail closed.", {
			code: "COMPUTER_BROKER_UNAVAILABLE",
		});
		expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
		expect(() => createComputerBrokerControllerFromEnvironment()).toThrow(
			"Computer broker is required but unavailable",
		);
	} finally {
		warning.mockRestore();
		for (const key of brokerEnvironment) {
			const value = previousEnvironment.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

it("rethrows unknown broker acquisition failures", async () => {
	const failure = new Error("unexpected broker acquisition failure");

	await expect(
		runRootCommand(parseArgs(["--resume"]), [], {
			acquireComputerBrokerLease: async () => {
				throw failure;
			},
			suppressProcessExit: true,
		}),
	).rejects.toBe(failure);
});

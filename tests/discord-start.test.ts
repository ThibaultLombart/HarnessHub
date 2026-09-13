import { EventEmitter } from "node:events";
import { Client, Events } from "discord.js";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import type { HarnessHubApplication } from "../src/application/application.js";
import { DiscordBot } from "../src/infrastructure/discord/discord-bot.js";

describe("DiscordBot startup", () => {
  it("waits for ClientReady before registering guild commands", async () => {
    const commandSet = vi.fn().mockResolvedValue(undefined);
    const client = new EventEmitter() as EventEmitter & {
      application: { commands: { set: typeof commandSet } };
      login: (token: string) => Promise<string>;
      isReady: () => boolean;
    };
    client.application = { commands: { set: commandSet } };
    client.isReady = () => false;
    client.login = async (token: string) => {
      setTimeout(() => client.emit(Events.ClientReady, client), 0);
      return token;
    };

    const bot = new DiscordBot(
      client as unknown as Client,
      "12345678901234567",
      "token",
      {} as HarnessHubApplication,
      { info: vi.fn() } as unknown as Logger,
    );

    await bot.start();

    expect(commandSet).toHaveBeenCalledOnce();
    expect(commandSet).toHaveBeenCalledWith(expect.any(Array), "12345678901234567");
  });
});

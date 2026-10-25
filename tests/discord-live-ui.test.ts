import { describe, expect, it, vi } from "vitest";
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  MessageCreateOptions,
  MessageEditOptions,
  ModalBuilder,
} from "discord.js";
import type { UiResponse } from "../src/domain/live-interface.js";
import { DiscordLiveUi } from "../src/infrastructure/discord/live-ui.js";
import type { HarnessEvent } from "../src/domain/harness.js";
const actor = { guildId: "guild", userId: "admin", channelId: "channel" };
function request(method = "select"): Extract<HarnessEvent, { type: "ui-request" }> {
  return {
    type: "ui-request",
    sessionId: "process",
    request: {
      id: "question",
      method: method as "select",
      title: "Choose",
      message: "",
      options: Array.from({ length: 70 }, (_, i) => `Option ${String(i)}`),
      expiresAt: Date.now() + 60_000,
    },
  };
}
function setup() {
  const respondUi = vi
    .fn<
      (input: typeof actor & { sessionId: string; requestId: string }, response: UiResponse) => Promise<void>
    >()
    .mockResolvedValue(undefined);
  const application = { projectForChannel: vi.fn(() => ({ id: "project" })), respondUi };
  const ui = new DiscordLiveUi(application);
  const edit = vi.fn<(payload: MessageEditOptions) => Promise<void>>().mockResolvedValue(undefined);
  const send = vi
    .fn<(payload: MessageCreateOptions) => Promise<{ edit: typeof edit }>>()
    .mockResolvedValue({ edit });
  return { ui, application, respondUi, send, edit };
}
function interaction(id: string, kind = "button") {
  return {
    customId: id,
    guildId: actor.guildId,
    user: { id: actor.userId },
    channelId: actor.channelId,
    isButton: () => kind === "button",
    isStringSelectMenu: () => kind === "select",
    isModalSubmit: () => kind === "modal",
    values: ["2"],
    fields: { getTextInputValue: () => "Custom answer" },
    reply: vi.fn(async () => undefined),
    deferUpdate: vi.fn(async () => undefined),
    showModal: vi.fn<(modal: ModalBuilder) => Promise<void>>().mockResolvedValue(undefined),
    update: vi.fn<(payload: MessageEditOptions) => Promise<void>>().mockResolvedValue(undefined),
  };
}
function customId(send: ReturnType<typeof setup>["send"], action: string) {
  const payload = send.mock.calls[0]?.[0] as unknown as {
    components: { toJSON(): { components: { custom_id?: string }[] } }[];
  };
  const ids = payload.components.flatMap((row) =>
    row.toJSON().components.map((component) => component.custom_id ?? ""),
  );
  const id = ids.find((value) => value.includes(`:${action}`));
  if (!id) throw new Error(`No ${action} control`);
  return id;
}
describe("Discord live dialog handler", () => {
  it("keeps the model snapshot attached to each process question across pagination and closure", async () => {
    const { ui, send, edit } = setup();
    await ui.publish(actor, request(), send, "first/model");
    const firstId = customId(send, "select");
    await ui.publish(actor, { ...request(), sessionId: "replacement" }, send, "second/model");
    const page = interaction(firstId.replace(":select", ":next"));
    await ui.handle(page as unknown as ButtonInteraction);
    expect(page.update.mock.calls[0]?.[0].content).toContain("Model used: first/model");
    expect(send.mock.calls[1]?.[0].content).toContain("Model used: second/model");
    await ui.closedRequest("process", "question");
    expect(edit.mock.calls.at(-1)?.[0].content).toContain("Model used: first/model");
    await ui.close();
  });
  it("cancels a decision that cannot fit with its footer rather than truncating it", async () => {
    const { ui, send, respondUi } = setup();
    await ui.publish(
      actor,
      {
        ...request("confirm"),
        request: { ...request("confirm").request, title: "*".repeat(700), message: "*".repeat(500) },
      },
      send,
      "p/" + "m".repeat(158),
    );
    expect(send).not.toHaveBeenCalled();
    expect(respondUi).toHaveBeenCalledExactlyOnceWith(expect.anything(), { cancelled: true });
    await ui.close();
  });
  it("pages selections and sends exact indexed correlated response only once", async () => {
    const { ui, respondUi, send } = setup();
    await ui.publish(actor, request(), send);
    const id = customId(send, "select");
    const select = interaction(id, "select");
    await ui.handle(select as unknown as StringSelectMenuInteraction);
    await ui.handle(select as unknown as StringSelectMenuInteraction);
    expect(respondUi).toHaveBeenCalledExactlyOnceWith(
      { ...actor, sessionId: "process", requestId: "question" },
      { choice: 2 },
    );
    expect(select.reply).toHaveBeenCalled();
    await ui.close();
  });
  it("opens a modal for input/editor and accepts its submission, not ordinary prompts", async () => {
    for (const method of ["input", "editor"]) {
      const { ui, send, respondUi } = setup();
      await ui.publish(actor, request(method), send);
      const button = interaction(customId(send, "respond"));
      await ui.handle(button as unknown as ButtonInteraction);
      const modal = button.showModal.mock.calls[0]?.[0] as unknown as { toJSON(): { custom_id: string } };
      expect(modal).toBeDefined();
      await ui.handle(interaction(modal.toJSON().custom_id, "modal") as unknown as ModalSubmitInteraction);
      expect(respondUi).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "process" }), {
        value: "Custom answer",
      });
      await ui.close();
    }
  });
  it("cancels explicitly and never auto-confirms, rejects foreign channels/users and stale handles", async () => {
    const { ui, send, respondUi } = setup();
    await ui.publish(actor, request("confirm"), send);
    const cancel = interaction(customId(send, "cancel"));
    await ui.handle({ ...cancel, user: { id: "other" } } as unknown as ButtonInteraction);
    await ui.handle({ ...cancel, channelId: "foreign" } as unknown as ButtonInteraction);
    expect(respondUi).not.toHaveBeenCalled();
    await ui.handle(cancel as unknown as ButtonInteraction);
    expect(respondUi).toHaveBeenCalledExactlyOnceWith(expect.anything(), { cancelled: true });
    await ui.close();
  });
  it("cancels on send/edit failure, expiry and shutdown; bounded flooding", async () => {
    const { ui, send, respondUi } = setup();
    send.mockRejectedValueOnce(new Error("Discord offline"));
    await ui.publish(actor, request(), send);
    expect(respondUi).toHaveBeenCalledWith(expect.anything(), { cancelled: true });
    respondUi.mockClear();
    await ui.publish(
      actor,
      { ...request(), request: { ...request().request, id: "second", expiresAt: Date.now() + 20 } },
      send,
    );
    await vi.waitFor(() => expect(respondUi).toHaveBeenCalled());
    await ui.close();
  });
  it("pages by 25 and rejects malformed, off-page and foreign-guild selections", async () => {
    const { ui, send, respondUi } = setup();
    await ui.publish(actor, request(), send);
    const id = customId(send, "select");
    await ui.handle(interaction(id.replace(":select", ":next")) as unknown as ButtonInteraction);
    for (const values of [["2"], [""], ["2e1"], ["25", "26"], ["-1"], ["NaN"], ["25x"]]) {
      const select = { ...interaction(id, "select"), values };
      await ui.handle(select as unknown as StringSelectMenuInteraction);
      expect(select.reply).toHaveBeenCalled();
    }
    await ui.handle({
      ...interaction(id, "select"),
      values: ["25"],
      guildId: "foreign",
    } as unknown as StringSelectMenuInteraction);
    expect(respondUi).not.toHaveBeenCalled();
    await ui.handle({
      ...interaction(id, "select"),
      values: ["25"],
    } as unknown as StringSelectMenuInteraction);
    expect(respondUi).toHaveBeenCalledWith(expect.anything(), { choice: 25 });
    await ui.close();
  });
  it("invalidates stale modal nonces and process closures and rechecks authorization", async () => {
    const { ui, send, application, respondUi } = setup();
    await ui.publish(actor, request("input"), send);
    const button = interaction(customId(send, "respond"));
    await ui.handle(button as unknown as ButtonInteraction);
    await ui.handle(button as unknown as ButtonInteraction);
    const first = button.showModal.mock.calls[0]?.[0];
    const second = button.showModal.mock.calls[1]?.[0];
    if (!first || !second) throw new Error("No modal");
    const stale = interaction(first.toJSON().custom_id, "modal");
    await ui.handle(stale as unknown as ModalSubmitInteraction);
    expect(stale.reply).toHaveBeenCalled();
    application.projectForChannel.mockImplementationOnce(() => {
      throw new Error("Admin changed");
    });
    await ui.handle(interaction(second.toJSON().custom_id, "modal") as unknown as ModalSubmitInteraction);
    expect(respondUi).not.toHaveBeenCalled();
    await ui.closedRequest("foreign-process", "question");
    await ui.closedRequest("process", "question");
    const closed = interaction(second.toJSON().custom_id, "modal");
    await ui.handle(closed as unknown as ModalSubmitInteraction);
    expect(closed.reply).toHaveBeenCalled();
    expect(respondUi).not.toHaveBeenCalled();
    await ui.close();
  });
  it("fails closed when component delivery or acknowledgement fails", async () => {
    for (const failure of ["page", "modal", "ack"]) {
      const { ui, send, respondUi } = setup();
      await ui.publish(actor, request(failure === "modal" ? "input" : "select"), send);
      const action = failure === "page" ? "next" : failure === "modal" ? "respond" : "cancel";
      const control = interaction(
        failure === "page" ? customId(send, "select").replace(":select", ":next") : customId(send, action),
      );
      control.update.mockRejectedValueOnce(new Error("offline"));
      control.showModal.mockRejectedValueOnce(new Error("offline"));
      control.deferUpdate.mockRejectedValueOnce(new Error("offline"));
      await ui.handle(control as unknown as ButtonInteraction);
      expect(respondUi).toHaveBeenCalledExactlyOnceWith(expect.anything(), { cancelled: true });
      await ui.close();
    }
  });
  it("bounds in-flight Discord deliveries even after questions expire", async () => {
    vi.useFakeTimers();
    const { ui, send, edit } = setup();
    const deliveries: (() => void)[] = [];
    send.mockImplementation(
      () =>
        new Promise((resolve) => {
          deliveries.push(() => resolve({ edit }));
        }),
    );
    const pending: Promise<void>[] = [];
    try {
      for (let i = 0; i < 8; i++) {
        pending.push(
          ui.publish(
            actor,
            { ...request(), request: { ...request().request, id: String(i), expiresAt: Date.now() + 1 } },
            send,
          ),
        );
        await vi.advanceTimersByTimeAsync(2);
      }
      expect(send).toHaveBeenCalledTimes(4);
    } finally {
      for (const deliver of deliveries) deliver();
      await Promise.all(pending);
      await ui.close();
      vi.useRealTimers();
    }
  });
  it("bounds pending requests and cancels all outstanding questions on close", async () => {
    const { ui, send, respondUi } = setup();
    for (let i = 0; i < 8; i++)
      await ui.publish(actor, { ...request(), request: { ...request().request, id: String(i) } }, send);
    expect(send).toHaveBeenCalledTimes(4);
    expect(respondUi).toHaveBeenCalledTimes(4);
    await ui.close();
    expect(respondUi).toHaveBeenCalledTimes(8);
    expect(respondUi.mock.calls.every(([, response]) => "cancelled" in response)).toBe(true);
  });
});

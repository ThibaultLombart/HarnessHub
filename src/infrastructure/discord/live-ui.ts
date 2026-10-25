import { escapeMarkdownText } from "../../domain/display-text.js";
import { discordContentMaximum, withModelFooter } from "./model-footer.js";
import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  LabelBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import type { HarnessEvent } from "../../domain/harness.js";
import type { UiRequest, UiResponse } from "../../domain/live-interface.js";

type Actor = { guildId: string; userId: string; channelId: string };
type MessageHandle = { edit(payload: MessageEditOptions): Promise<unknown> };
type Sender = (payload: MessageCreateOptions) => Promise<MessageHandle>;
type Entry = {
  actor: Actor;
  projectId: string;
  sessionId: string;
  modelLabel: string;
  request: UiRequest;
  page: number;
  message?: MessageHandle;
  timer: NodeJS.Timeout;
  modal?: string;
  busy: boolean;
};
type LiveApplication = {
  projectForChannel(actor: Actor): { id: string };
  respondUi(actor: Actor & { sessionId: string; requestId: string }, response: UiResponse): Promise<void>;
};

/** Discord presentation only; application and Pi independently recheck identity. */
export class DiscordLiveUi {
  private readonly entries = new Map<string, Entry>();
  private readonly deliveries = new Map<string, number>();
  private closed = false;
  public constructor(private readonly application: LiveApplication) {}

  public async publish(
    actor: Actor,
    event: Extract<HarnessEvent, { type: "ui-request" }>,
    send: Sender,
    modelLabel = "unknown",
  ): Promise<void> {
    const project = this.application.projectForChannel(actor);
    const binding = { ...actor, sessionId: event.sessionId, requestId: event.request.id };
    if (
      this.closed ||
      this.entries.size >= 100 ||
      [...this.deliveries.values()].reduce((sum, count) => sum + count, 0) >= 100 ||
      (this.deliveries.get(project.id) ?? 0) >= 4 ||
      [...this.entries.values()].filter((entry) => entry.projectId === project.id).length >= 4
    ) {
      await this.application.respondUi(binding, { cancelled: true }).catch(() => undefined);
      return;
    }
    const key = randomUUID();
    const timer = setTimeout(
      () => {
        void this.finish(key, { cancelled: true });
      },
      Math.max(1, event.request.expiresAt - Date.now()),
    );
    timer.unref();
    const entry: Entry = {
      actor,
      projectId: project.id,
      sessionId: event.sessionId,
      modelLabel,
      request: event.request,
      page: 0,
      timer,
      busy: false,
    };
    this.entries.set(key, entry);
    this.deliveries.set(project.id, (this.deliveries.get(project.id) ?? 0) + 1);
    try {
      const message = await send(this.render(key, entry));
      if (this.entries.get(key) !== entry)
        await message
          .edit({
            content: withModelFooter("Pi question closed.", entry.modelLabel),
            components: [],
            allowedMentions: { parse: [] },
          })
          .catch(() => undefined);
      else entry.message = message;
    } catch {
      await this.finish(key, { cancelled: true });
    } finally {
      const remaining = (this.deliveries.get(project.id) ?? 1) - 1;
      if (remaining === 0) this.deliveries.delete(project.id);
      else this.deliveries.set(project.id, remaining);
    }
  }

  public async handle(
    interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  ): Promise<boolean> {
    const parts = interaction.customId.split(":");
    const [namespace, key, action, extra] = parts;
    if (namespace !== "hhui") return false;
    const entry = key === undefined ? undefined : this.entries.get(key);
    const reject = async (): Promise<boolean> => {
      await interaction.reply({
        content: "Question is stale, unavailable, or not authorized here.",
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return true;
    };
    if (
      entry === undefined ||
      key === undefined ||
      parts.length !== (action === "submit" ? 4 : 3) ||
      entry.busy ||
      entry.actor.guildId !== interaction.guildId ||
      entry.actor.userId !== interaction.user.id ||
      entry.actor.channelId !== interaction.channelId ||
      Date.now() >= entry.request.expiresAt
    )
      return reject();
    try {
      if (this.application.projectForChannel(entry.actor).id !== entry.projectId) return await reject();
    } catch {
      return reject();
    }
    if (
      interaction.isButton() &&
      action === "respond" &&
      ["input", "editor"].includes(entry.request.method)
    ) {
      entry.modal = randomUUID();
      const input = new TextInputBuilder()
        .setCustomId("answer")
        .setStyle(entry.request.method === "editor" ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setMaxLength(4000)
        .setRequired(true);
      const modal = new ModalBuilder()
        .setCustomId(`hhui:${key}:submit:${entry.modal}`)
        .setTitle("Respond to Pi")
        .addLabelComponents(
          new LabelBuilder().setLabel("Answer (never enter credentials)").setTextInputComponent(input),
        );
      try {
        await interaction.showModal(modal);
      } catch {
        await this.finish(key, { cancelled: true });
      }
      return true;
    }
    if (
      interaction.isButton() &&
      (action === "next" || action === "previous") &&
      entry.request.method === "select"
    ) {
      const nextPage = entry.page + (action === "next" ? 1 : -1);
      if (nextPage < 0 || nextPage >= Math.ceil(entry.request.options.length / 25)) return reject();
      entry.page = nextPage;
      entry.busy = true;
      try {
        await interaction.update(this.render(key, entry));
      } catch {
        await this.finish(key, { cancelled: true });
      } finally {
        entry.busy = false;
      }
      return true;
    }
    let response: UiResponse;
    if (interaction.isButton() && action === "cancel") response = { cancelled: true };
    else if (
      interaction.isButton() &&
      entry.request.method === "confirm" &&
      (action === "yes" || action === "no")
    )
      response = { confirmed: action === "yes" };
    else if (interaction.isStringSelectMenu() && action === "select" && entry.request.method === "select") {
      const rawIndex = interaction.values[0] ?? "";
      if (!/^(0|[1-9][0-9]{0,2})$/.test(rawIndex)) return reject();
      const index = Number(rawIndex);
      if (
        interaction.values.length !== 1 ||
        !Number.isInteger(index) ||
        index < entry.page * 25 ||
        index >= Math.min(entry.request.options.length, (entry.page + 1) * 25)
      )
        return reject();
      response = { choice: index };
    } else if (
      interaction.isModalSubmit() &&
      action === "submit" &&
      extra === entry.modal &&
      ["input", "editor"].includes(entry.request.method)
    ) {
      const value = interaction.fields.getTextInputValue("answer");
      if (value.trim() === "" || value.length > 4000) return reject();
      response = { value };
    } else return reject();
    // Claim before acknowledging or doing I/O, including concurrent duplicate clicks.
    entry.busy = true;
    try {
      await interaction.deferUpdate();
    } catch {
      await this.finish(key, { cancelled: true });
      return true;
    }
    await this.finish(key, response);
    return true;
  }

  public async closedRequest(sessionId: string, requestId: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.sessionId === sessionId && entry.request.id === requestId) await this.remove(key);
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.entries.keys()].map(async (key) => this.finish(key, { cancelled: true })));
  }

  private async finish(key: string, response: UiResponse): Promise<void> {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    // Remove synchronously, before application I/O; keep the message cleanup independent.
    this.entries.delete(key);
    clearTimeout(entry.timer);
    try {
      await this.application.respondUi(
        { ...entry.actor, sessionId: entry.sessionId, requestId: entry.request.id },
        response,
      );
    } catch {
      // A failed acknowledgement is never approval. Best-effort cancellation; Pi expiry is the backstop.
      await this.application
        .respondUi(
          { ...entry.actor, sessionId: entry.sessionId, requestId: entry.request.id },
          { cancelled: true },
        )
        .catch(() => undefined);
    }
    await this.clearMessage(entry);
  }

  private async remove(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.entries.delete(key);
    clearTimeout(entry.timer);
    await this.clearMessage(entry);
  }
  private async clearMessage(entry: Entry): Promise<void> {
    await entry.message
      ?.edit({
        content: withModelFooter("Pi question closed (answered, cancelled, or expired).", entry.modelLabel),
        components: [],
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }
  private render(key: string, entry: Entry): MessageCreateOptions & MessageEditOptions {
    const rows: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[] = [];
    const buttons = new ActionRowBuilder<ButtonBuilder>();
    const button = (action: string, label: string, style = ButtonStyle.Secondary): ButtonBuilder =>
      new ButtonBuilder().setCustomId(`hhui:${key}:${action}`).setLabel(label).setStyle(style);
    if (entry.request.method === "select") {
      const options = entry.request.options
        .slice(entry.page * 25, (entry.page + 1) * 25)
        .map((label, index) => ({
          label: label || "(empty option)",
          value: String(entry.page * 25 + index),
        }));
      if (options.length > 0)
        rows.push(
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`hhui:${key}:select`)
              .setPlaceholder(
                `Page ${String(entry.page + 1)} of ${String(Math.ceil(entry.request.options.length / 25))}`,
              )
              .addOptions(options),
          ),
        );
      if (entry.page > 0) buttons.addComponents(button("previous", "Previous"));
      if ((entry.page + 1) * 25 < entry.request.options.length) buttons.addComponents(button("next", "Next"));
    } else if (entry.request.method === "confirm")
      buttons.addComponents(button("yes", "Confirm", ButtonStyle.Danger), button("no", "No"));
    else buttons.addComponents(button("respond", "Respond"));
    buttons.addComponents(button("cancel", "Cancel"));
    rows.push(buttons);
    const content = withModelFooter(
      `Pi needs your response\n${escapeMarkdownText(entry.request.title)}\n${escapeMarkdownText(entry.request.message)}\nExpires <t:${String(Math.floor(entry.request.expiresAt / 1000))}:R>. No automatic approval.`,
      entry.modelLabel,
    );
    // Never truncate decision context to make room for presentation or the model footer.
    if (content.length > discordContentMaximum) throw new Error("Pi question exceeds Discord display limit");
    return {
      content,
      components: rows,
      allowedMentions: { parse: [] },
    };
  }
}

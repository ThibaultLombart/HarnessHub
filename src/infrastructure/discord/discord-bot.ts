import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
} from "discord.js";
import type { Logger } from "pino";
import type { HarnessHubApplication } from "../../application/application.js";
import type { HarnessEvent } from "../../domain/harness.js";
import type { ModelDescriptor } from "../../domain/model.js";
import type { HarnessResource, ResourceScope } from "../../domain/resource.js";
import { SessionProgress } from "../../domain/session-progress.js";

const progressUpdateIntervalMs = 15_000;
const stalledProgressAfterMs = 120_000;

const commands = [
  new SlashCommandBuilder().setName("setup").setDescription("Create or reconnect the HarnessHub workspace"),
  new SlashCommandBuilder()
    .setName("project")
    .setDescription("Manage projects")
    .addSubcommand((command) =>
      command
        .setName("create")
        .setDescription("Create an empty project or clone a repository")
        .addStringOption((option) =>
          option.setName("name").setDescription("Project name").setRequired(true).setMaxLength(100),
        )
        .addStringOption((option) =>
          option
            .setName("repository")
            .setDescription("Optional HTTPS or SSH repository URL")
            .setMaxLength(2048),
        ),
    )
    .addSubcommand((command) => command.setName("status").setDescription("Show the current project status"))
    .addSubcommand((command) =>
      command
        .setName("archive")
        .setDescription("Archive the current project after explicit slug confirmation")
        .addStringOption((option) =>
          option.setName("confirm").setDescription("Type the project slug to confirm").setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("delete")
        .setDescription("Delete the current project after explicit slug confirmation")
        .addStringOption((option) =>
          option.setName("confirm").setDescription("Type the project slug to confirm").setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName("harness")
    .setDescription("Manage the coding harness")
    .addSubcommand((command) => command.setName("detect").setDescription("Detect the Pi installation"))
    .addSubcommand((command) =>
      command.setName("auth").setDescription("Check native Pi provider authentication"),
    )
    .addSubcommand((command) => command.setName("install").setDescription("Explicitly install Pi")),
  new SlashCommandBuilder()
    .setName("model")
    .setDescription("View and select the Pi model for a project")
    .addSubcommand((command) => command.setName("list").setDescription("List available Pi models"))
    .addSubcommand((command) =>
      command.setName("status").setDescription("Show this project's selected model"),
    )
    .addSubcommand((command) =>
      command
        .setName("set")
        .setDescription("Select the Pi model for this project")
        .addStringOption((option) =>
          option
            .setName("model")
            .setDescription("Model pattern, for example anthropic/claude-sonnet-4-5")
            .setRequired(true)
            .setMaxLength(200),
        ),
    )
    .addSubcommand((command) =>
      command.setName("reset").setDescription("Use Pi's default model for this project"),
    ),
  new SlashCommandBuilder()
    .setName("resource")
    .setDescription("Manage Pi packages, skills, and harness resources")
    .addSubcommand((command) =>
      command
        .setName("add")
        .setDescription("Install a Pi package globally or for this project")
        .addStringOption((option) =>
          option
            .setName("scope")
            .setDescription("Install globally or for the current project")
            .setRequired(true)
            .addChoices({ name: "global", value: "global" }, { name: "project", value: "project" }),
        )
        .addStringOption((option) =>
          option
            .setName("source")
            .setDescription("Package source: npm:, git:, https:, or ssh:")
            .setRequired(true)
            .setMaxLength(2048),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("list")
        .setDescription("List installed HarnessHub resources")
        .addStringOption((option) =>
          option
            .setName("scope")
            .setDescription("Optional scope filter")
            .addChoices({ name: "global", value: "global" }, { name: "project", value: "project" }),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("remove")
        .setDescription("Remove a managed Pi package by resource ID")
        .addStringOption((option) =>
          option
            .setName("scope")
            .setDescription("Resource scope")
            .setRequired(true)
            .addChoices({ name: "global", value: "global" }, { name: "project", value: "project" }),
        )
        .addStringOption((option) =>
          option.setName("id").setDescription("Resource ID from /resource list").setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName("session")
    .setDescription("Manage the current project session")
    .addSubcommand((command) => command.setName("stop").setDescription("Stop the active Pi operation"))
    .addSubcommand((command) => command.setName("resume").setDescription("Resume the project's Pi session")),
].map((command) => command.toJSON());

export function createDiscordClient(): Client {
  return new Client({
    allowedMentions: { parse: [] },
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
}

export class DiscordBot {
  public constructor(
    private readonly client: Client,
    private readonly guildId: string,
    private readonly token: string,
    private readonly application: HarnessHubApplication,
    private readonly logger: Logger,
  ) {}

  public async start(): Promise<void> {
    this.client.on(Events.InteractionCreate, (interaction) => {
      void this.handleInteraction(interaction).catch((error: unknown) =>
        this.logger.error({ error }, "Discord interaction failed"),
      );
    });
    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message).catch((error: unknown) =>
        this.logger.error({ error }, "Discord message handling failed"),
      );
    });
    await this.client.login(this.token);
    if (!this.client.isReady()) {
      await new Promise<void>((resolve, reject) => {
        const onReady = (): void => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          this.client.off(Events.ClientReady, onReady);
          reject(new Error("Discord client did not become ready within 30 seconds"));
        }, 30_000);
        this.client.once(Events.ClientReady, onReady);
      });
    }
    const clientApplication = this.client.application;
    if (clientApplication === null)
      throw new Error("Discord application is unavailable after client readiness");
    await clientApplication.commands.set(commands, this.guildId);
    this.logger.info({ guildId: this.guildId }, "Discord commands registered");
  }

  public async stop(): Promise<void> {
    await this.client.destroy();
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) await this.handleCommand(interaction);
    else if (interaction.isButton()) await this.handleButton(interaction);
  }

  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const actor = actorFrom(interaction.guildId, interaction.user.id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (interaction.commandName === "setup") {
        const workspace = await this.application.setup(actor);
        await interaction.editReply(`HarnessHub is ready in <#${workspace.managementChannelId}>.`);
      } else if (interaction.commandName === "project") {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "create") {
          const repository = interaction.options.getString("repository") ?? undefined;
          const project = await this.application.createProject(
            { ...actor, channelId: interaction.channelId },
            {
              name: interaction.options.getString("name", true),
              ...(repository === undefined ? {} : { repositoryUrl: repository }),
            },
          );
          await interaction.editReply(`Project created: <#${project.channelId}>.`);
        } else if (subcommand === "status") {
          await interaction.editReply(
            await this.application.projectStatus({ ...actor, channelId: interaction.channelId }),
          );
        } else if (subcommand === "archive") {
          const project = await this.application.archiveProject(
            { ...actor, channelId: interaction.channelId },
            { confirm: interaction.options.getString("confirm", true) },
          );
          await interaction.editReply(`Project archived: ${project.slug}.`);
        } else {
          const project = await this.application.deleteProject(
            { ...actor, channelId: interaction.channelId },
            { confirm: interaction.options.getString("confirm", true) },
          );
          await interaction.editReply(`Project deleted: ${project.slug}.`);
        }
      } else if (interaction.commandName === "harness") {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "detect") {
          const detection = await this.application.detectHarness({
            ...actor,
            channelId: interaction.channelId,
          });
          await interaction.editReply(
            detection.installed
              ? `Pi ${detection.version ?? "(unknown version)"} is installed.`
              : "Pi is not installed.",
          );
        } else if (subcommand === "auth") {
          const status = await this.application.getAuthStatus({ ...actor, channelId: interaction.channelId });
          await interaction.editReply(
            status.authenticated
              ? `Pi authentication is available for: ${status.providers.join(", ") || "configured provider"}.`
              : "Pi has no authenticated model available. Authenticate natively as the service account.",
          );
        } else {
          await this.application.installHarness({ ...actor, channelId: interaction.channelId });
          await interaction.editReply("Pi installation completed.");
        }
      } else if (interaction.commandName === "model") {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "list") {
          const models = await this.application.listModels({ ...actor, channelId: interaction.channelId });
          await interaction.editReply(formatModels(models));
        } else if (subcommand === "status") {
          const preference = this.application.modelStatus({ ...actor, channelId: interaction.channelId });
          await interaction.editReply(
            preference === null
              ? "This project uses Pi's default model."
              : `Selected model: ${preference.provider}/${preference.modelId}`,
          );
        } else if (subcommand === "set") {
          const preference = await this.application.setProjectModel(
            { ...actor, channelId: interaction.channelId },
            { model: interaction.options.getString("model", true) },
          );
          await interaction.editReply(`Selected model: ${preference.provider}/${preference.modelId}.`);
        } else {
          this.application.resetProjectModel({ ...actor, channelId: interaction.channelId });
          await interaction.editReply("This project now uses Pi's default model.");
        }
      } else if (interaction.commandName === "resource") {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "add") {
          const resource = await this.application.installResource(
            { ...actor, channelId: interaction.channelId },
            {
              scope: resourceScope(interaction.options.getString("scope", true)),
              source: interaction.options.getString("source", true),
            },
          );
          await interaction.editReply(`Resource installed: ${formatResource(resource)}.`);
        } else if (subcommand === "remove") {
          const resource = await this.application.removeResource(
            { ...actor, channelId: interaction.channelId },
            {
              scope: resourceScope(interaction.options.getString("scope", true)),
              id: interaction.options.getString("id", true),
            },
          );
          await interaction.editReply(`Resource removed: ${formatResource(resource)}.`);
        } else {
          const resources = this.application.listResources(
            { ...actor, channelId: interaction.channelId },
            optionalResourceScope(interaction.options.getString("scope")),
          );
          await interaction.editReply(formatResources(resources));
        }
      } else if (interaction.commandName === "session") {
        const project = this.application.projectForChannel({ ...actor, channelId: interaction.channelId });
        if (interaction.options.getSubcommand() === "stop") {
          await this.application.stop(actor, project.id);
          await interaction.editReply("Session stopped.");
        } else {
          await this.application.resume(actor, project.id, () => undefined);
          await interaction.editReply("Session resumed and idle.");
        }
      }
    } catch (error) {
      this.logger.warn({ error, command: interaction.commandName }, "Discord command was rejected or failed");
      await interaction.editReply(safeDiscordError(error));
    }
  }

  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [namespace, action, projectId] = interaction.customId.split(":");
    if (namespace !== "hh" || projectId === undefined || (action !== "stop" && action !== "resume")) return;
    const actor = actorFrom(interaction.guildId, interaction.user.id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (action === "stop") await this.application.stop(actor, projectId);
      else await this.application.resume(actor, projectId, () => undefined);
      await interaction.editReply(action === "stop" ? "Session stopped." : "Session resumed and idle.");
    } catch (error) {
      this.logger.warn({ error, action }, "Discord session control failed");
      await interaction.editReply(safeDiscordError(error));
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot || message.guildId === null || message.content.trim() === "") return;
    const actor = { guildId: message.guildId, userId: message.author.id };
    let project;
    try {
      project = this.application.projectForChannel({ ...actor, channelId: message.channelId });
    } catch {
      return;
    }

    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`hh:stop:${project.id}`).setLabel("Stop").setStyle(ButtonStyle.Danger),
    );
    const tracker = new SessionProgress();
    const progress = await message.reply({
      content: tracker.render({ stalledAfterMs: stalledProgressAfterMs }),
      components: [controls],
      allowedMentions: { parse: [] },
    });
    let lastStatus = tracker.render({ stalledAfterMs: stalledProgressAfterMs });
    let finished = false;
    let updateChain = Promise.resolve();
    const scheduleProgressUpdate = (): void => {
      if (finished) return;
      const status = tracker.render({ stalledAfterMs: stalledProgressAfterMs });
      if (status === lastStatus) return;
      lastStatus = status;
      updateChain = updateChain
        .then(async () =>
          progress.edit({ content: status, components: [controls], allowedMentions: { parse: [] } }),
        )
        .then(() => undefined)
        .catch((error: unknown) =>
          this.logger.warn({ error, projectId: project.id }, "Could not update Discord progress"),
        );
    };
    const interval = setInterval(scheduleProgressUpdate, progressUpdateIntervalMs);
    const onEvent = (event: HarnessEvent): void => {
      tracker.record(event);
      scheduleProgressUpdate();
    };

    try {
      const answer = await this.application.prompt(
        { ...actor, channelId: message.channelId, content: message.content },
        onEvent,
      );
      finished = true;
      clearInterval(interval);
      await updateChain;
      const chunks = splitDiscordMessage(answer);
      await progress.edit({
        content: chunks.shift() ?? "Pi completed.",
        components: [],
        allowedMentions: { parse: [] },
      });
      if (chunks.length > 0 && !message.channel.isSendable())
        throw new Error("Discord channel is no longer sendable");
      for (const chunk of chunks) {
        if (message.channel.isSendable()) {
          await message.channel.send({ content: chunk, allowedMentions: { parse: [] } });
        }
      }
    } catch (error) {
      finished = true;
      clearInterval(interval);
      this.logger.warn({ error, projectId: project.id }, "Pi prompt failed");
      await updateChain;
      await progress.edit({
        content: safeDiscordError(error),
        components: [],
        allowedMentions: { parse: [] },
      });
    }
  }
}

function actorFrom(guildId: string | null, userId: string): { guildId: string; userId: string } {
  return { guildId: guildId ?? "", userId };
}

function formatModels(models: readonly ModelDescriptor[], maximumLength = 1900): string {
  if (models.length === 0) return "No Pi models are currently available. Check native Pi authentication.";
  const lines: string[] = [];
  for (const model of models) {
    const line = `${model.provider}/${model.id}${model.label === "" ? "" : ` — ${model.label}`}`;
    const next = [...lines, line].join("\n");
    if (next.length > maximumLength) {
      lines.push(`…and ${String(models.length - lines.length)} more model(s).`);
      break;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function resourceScope(value: string): ResourceScope {
  if (value === "global" || value === "project") return value;
  throw new Error("Invalid resource scope");
}

function optionalResourceScope(value: string | null): ResourceScope | undefined {
  return value === null ? undefined : resourceScope(value);
}

function formatResources(resources: readonly HarnessResource[], maximumLength = 1900): string {
  const visible = resources.filter((resource) => resource.status !== "removed");
  if (visible.length === 0) return "No managed resources found.";
  const lines: string[] = [];
  for (const resource of visible) {
    const line = formatResource(resource);
    const next = [...lines, line].join("\n");
    if (next.length > maximumLength) {
      lines.push(`…and ${String(visible.length - lines.length)} more resource(s).`);
      break;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function formatResource(resource: HarnessResource): string {
  const id = resource.id.slice(0, 8);
  const project = resource.scope === "project" ? ` project:${resource.projectId ?? "unknown"}` : "";
  const error = resource.safeError === null ? "" : ` — ${resource.safeError}`;
  return `${id} ${resource.scope}${project} ${resource.type} ${resource.source} [${resource.status}]${error}`;
}

export function splitDiscordMessage(message: string, maximum = 1900): string[] {
  if (message.length <= maximum) return [message];
  const chunks: string[] = [];
  let remaining = message;
  while (remaining.length > maximum) {
    const newline = remaining.lastIndexOf("\n", maximum);
    let splitAt = newline > maximum / 2 ? newline : maximum;
    if (/^[\uD800-\uDBFF]$/.test(remaining.charAt(splitAt - 1))) splitAt -= 1;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  if (remaining !== "") chunks.push(remaining);
  return chunks;
}

export function safeDiscordError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === 50_013)
    return "HarnessHub needs the Discord permissions Manage Channels and Manage Roles to set up its private workspace.";
  if (
    error instanceof Error &&
    [
      "UnauthorizedError",
      "UnmappedChannelError",
      "ManagementChannelRequiredError",
      "ProjectAlreadyExistsError",
      "ProjectDegradedError",
      "ProjectDeletionBlockedError",
      "InvalidProjectInputError",
      "InvalidResourceInputError",
      "InvalidModelInputError",
      "ModelManagementUnsupportedError",
      "ResourceNotFoundError",
      "ResourceProjectRequiredError",
      "ResourceScopeMismatchError",
      "SessionBusyError",
      "SessionStoppedError",
      "WorkspaceDegradedError",
    ].includes(error.name)
  ) {
    return error.message;
  }
  if (error instanceof Error && error.message === "Run /setup before creating a project")
    return error.message;
  return "Operation failed. Check the redacted HarnessHub service logs.";
}

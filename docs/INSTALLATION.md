# Install HarnessHub on Linux

The MVP supports one Linux host, one Discord guild, and one administrator. Do not run HarnessHub as root.

## Prerequisites

- Node.js 22 or 24
- Git
- a Discord application with a bot token
- a non-root `harnesshub` service account
- Pi credentials configured natively for that same service account (Pi may be preinstalled or installed later with `/harness install`)

Enable the bot's **Message Content** privileged intent. Invite it only to the intended guild with permission to view messages and manage channels.

## Build

```bash
npm ci
npm run check
```

Copy the validated checkout to `/opt/harnesshub`. Keep it owned by root and readable by the service account; runtime state must not be written there.

## State and configuration

Create state with restrictive ownership:

```bash
sudo install -d -o harnesshub -g harnesshub -m 0700 /var/lib/harnesshub /var/lib/harnesshub/pi-agent /srv/harnesshub/workspaces
sudo install -d -o root -g harnesshub -m 0750 /etc/harnesshub
sudo install -o root -g harnesshub -m 0640 .env.example /etc/harnesshub/harnesshub.env
```

Edit `/etc/harnesshub/harnesshub.env` locally. Set the Discord token, guild ID, administrator user ID, absolute workspace path, and absolute database path. Never paste credentials into Discord or commit this file.

Keep `PI_CODING_AGENT_DIR=/var/lib/harnesshub/pi-agent` in the environment file. This permits systemd to protect home directories while Pi reads its native configuration from writable HarnessHub state.

Authenticate Pi as the service account using the same agent directory:

```bash
sudo -u harnesshub -H env PI_CODING_AGENT_DIR=/var/lib/harnesshub/pi-agent pi
# Run /login, select the provider, complete its native flow, then quit.
```

`/harness install` installs the pinned MVP-compatible Pi release into `/var/lib/harnesshub/tools`; it does not require global npm write access. HarnessHub starts Pi with `--no-approve`: project-local executable Pi resources are ignored until a future explicit trust workflow is implemented. Pi is not sandboxed and still executes tools with the service account's permissions.

## systemd

Review `deploy/harnesshub.service` and adjust paths if needed, then install and start it:

```bash
sudo install -o root -g root -m 0644 deploy/harnesshub.service /etc/systemd/system/harnesshub.service
sudo systemctl daemon-reload
sudo systemctl enable --now harnesshub
sudo systemctl status harnesshub
```

After the bot is ready, run `/setup` in the configured guild. Run `/project create` from `#workspace-management`, then send a normal message in the created project channel.

## Operational notes

- Do not grant the service account sudo access.
- Configure SSH host keys before cloning over SSH; HarnessHub never accepts unknown keys automatically.
- Configure Git credentials directly for the service account. HarnessHub rejects credentials embedded in URLs.
- Back up `/var/lib/harnesshub` and the workspace root together while the service is stopped.
- Updating, deploying, or enabling this unit remains an explicit operator action.

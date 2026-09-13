#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly APP_USER="harnesshub"
readonly APP_GROUP="harnesshub"
readonly APP_DIR="/opt/harnesshub"
readonly STATE_DIR="/var/lib/harnesshub"
readonly WORKSPACE_DIR="/srv/harnesshub/workspaces"
readonly CONFIG_DIR="/etc/harnesshub"
readonly CONFIG_FILE="${CONFIG_DIR}/harnesshub.env"
readonly SERVICE_FILE="/etc/systemd/system/harnesshub.service"
readonly PI_PACKAGE="@earendil-works/pi-coding-agent@0.85.1"

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
NO_START=false
NO_PI_LOGIN=false
RECONFIGURE=false
STAGING_DIR=""
BACKUP_DIR=""

usage() {
  cat <<'USAGE'
Install HarnessHub on its supported Linux/systemd host.

Usage:
  sudo ./scripts/install.sh [options]

Options:
  --no-start       Install files but do not enable or start the service.
  --no-pi-login    Do not offer the interactive native Pi login after installation.
  --reconfigure    Replace the existing Discord configuration after prompting.
  -h, --help       Show this help.

The script installs HarnessHub and its pinned Pi version. It cannot create the
Discord application or complete the provider's OAuth/device authorization for you.
USAGE
}

cleanup() {
  local status="$?"
  if [[ -n "${STAGING_DIR}" && -d "${STAGING_DIR}" ]]; then
    rm -rf -- "${STAGING_DIR}"
  fi
  if [[ "${status}" -ne 0 && -n "${BACKUP_DIR}" && -d "${BACKUP_DIR}" ]]; then
    printf 'Installation failed. Previous application remains at %s\n' "${BACKUP_DIR}" >&2
    printf 'Rollback command: sudo rm -rf -- %s && sudo mv -- %s %s\n' \
      "${APP_DIR}" "${BACKUP_DIR}" "${APP_DIR}" >&2
  fi
  return "${status}"
}
trap cleanup EXIT

for argument in "$@"; do
  case "${argument}" in
    --no-start) NO_START=true ;;
    --no-pi-login) NO_PI_LOGIN=true ;;
    --reconfigure) RECONFIGURE=true ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "${argument}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  printf 'HarnessHub installation is supported on Linux only.\n' >&2
  exit 1
fi
if [[ "${EUID}" -ne 0 ]]; then
  printf 'Run this installer as root: sudo ./scripts/install.sh\n' >&2
  exit 1
fi

for command in node npm git systemctl useradd runuser install sed getent nologin; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    printf 'Missing prerequisite: %s\n' "${command}" >&2
    exit 1
  fi
done

NODE_VERSION="$(node --version | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REMAINDER="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REMAINDER%%.*}"
if (( NODE_MAJOR < 22 || NODE_MAJOR >= 25 || (NODE_MAJOR == 22 && NODE_MINOR < 5) )); then
  printf 'Unsupported Node.js version %s. Install Node.js 22.5 through 24.\n' "${NODE_VERSION}" >&2
  exit 1
fi
readonly NODE_BIN="$(command -v node)"
readonly NPM_BIN="$(command -v npm)"
readonly NOLOGIN_BIN="$(command -v nologin)"
if [[ ! "${NODE_BIN}" =~ ^/[a-zA-Z0-9._/-]+$ ]]; then
  printf 'The system Node.js path contains unsupported characters: %s\n' "${NODE_BIN}" >&2
  exit 1
fi
if [[ "${NODE_BIN}" == /home/* || "${NODE_BIN}" == /root/* || "${NPM_BIN}" == /home/* || "${NPM_BIN}" == /root/* ]]; then
  printf 'Node.js and npm must be installed system-wide, not through a user-only version manager.\n' >&2
  exit 1
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "${STATE_DIR}" --create-home --shell "${NOLOGIN_BIN}" "${APP_USER}"
fi
if ! getent group "${APP_GROUP}" >/dev/null 2>&1; then
  printf 'Existing service account has no matching %s group. Resolve it before installing.\n' "${APP_GROUP}" >&2
  exit 1
fi

install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0700 \
  "${STATE_DIR}" \
  "${STATE_DIR}/pi-agent" \
  "${STATE_DIR}/tools" \
  "${WORKSPACE_DIR}"
install -d -o root -g "${APP_GROUP}" -m 0750 "${CONFIG_DIR}"

prompt_nonempty() {
  local prompt="$1"
  local value=""
  while [[ -z "${value}" ]]; do
    read -r -p "${prompt}: " value
  done
  printf '%s' "${value}"
}

prompt_snowflake() {
  local prompt="$1"
  local value=""
  while true; do
    value="$(prompt_nonempty "${prompt}")"
    if [[ "${value}" =~ ^[0-9]{17,20}$ ]]; then
      printf '%s' "${value}"
      return
    fi
    printf 'Expected a Discord ID containing 17 to 20 digits.\n' >&2
  done
}

write_configuration() {
  local discord_token=""
  local guild_id=""
  local administrator_id=""
  while true; do
    read -r -s -p "Discord bot token: " discord_token
    printf '\n'
    if [[ -n "${discord_token}" && ! "${discord_token}" =~ [[:space:]] ]]; then
      break
    fi
    printf 'The Discord token must be non-empty and contain no whitespace.\n' >&2
  done
  guild_id="$(prompt_snowflake "Discord guild ID")"
  administrator_id="$(prompt_snowflake "Administrator Discord user ID")"

  local temporary_config
  temporary_config="$(mktemp "${CONFIG_DIR}/harnesshub.env.XXXXXX")"
  cat >"${temporary_config}" <<EOF
DISCORD_TOKEN=${discord_token}
DISCORD_GUILD_ID=${guild_id}
DISCORD_ADMIN_USER_ID=${administrator_id}
HARNESSHUB_WORKSPACE_ROOT=${WORKSPACE_DIR}
HARNESSHUB_DATABASE_PATH=${STATE_DIR}/harnesshub.sqlite
HARNESSHUB_PI_COMMAND=pi
PI_CODING_AGENT_DIR=${STATE_DIR}/pi-agent
HARNESSHUB_MAX_CONCURRENT_SESSIONS=2
LOG_LEVEL=info
EOF
  chown root:"${APP_GROUP}" "${temporary_config}"
  chmod 0640 "${temporary_config}"
  mv -f -- "${temporary_config}" "${CONFIG_FILE}"
}

if [[ ! -f "${CONFIG_FILE}" || "${RECONFIGURE}" == true ]]; then
  write_configuration
else
  printf 'Keeping existing configuration: %s\n' "${CONFIG_FILE}"
  chown root:"${APP_GROUP}" "${CONFIG_FILE}"
  chmod 0640 "${CONFIG_FILE}"
fi

BUILD_USER="${SUDO_USER:-root}"
if [[ "${BUILD_USER}" != "root" ]] && id "${BUILD_USER}" >/dev/null 2>&1; then
  BUILD_HOME="$(getent passwd "${BUILD_USER}" | cut -d: -f6)"
  runuser -u "${BUILD_USER}" -- env HOME="${BUILD_HOME}" "${NPM_BIN}" --prefix "${SOURCE_DIR}" ci
  runuser -u "${BUILD_USER}" -- env HOME="${BUILD_HOME}" "${NPM_BIN}" --prefix "${SOURCE_DIR}" run check
else
  "${NPM_BIN}" --prefix "${SOURCE_DIR}" ci
  "${NPM_BIN}" --prefix "${SOURCE_DIR}" run check
fi

STAGING_DIR="$(mktemp -d "/opt/harnesshub.install.XXXXXX")"
install -d -o root -g root -m 0755 "${STAGING_DIR}/dist" "${STAGING_DIR}/docs" "${STAGING_DIR}/deploy"
cp -a -- "${SOURCE_DIR}/dist/." "${STAGING_DIR}/dist/"
cp -a -- "${SOURCE_DIR}/package.json" "${SOURCE_DIR}/package-lock.json" "${SOURCE_DIR}/README.md" "${STAGING_DIR}/"
cp -a -- \
  "${SOURCE_DIR}/docs/INSTALLATION.md" \
  "${SOURCE_DIR}/docs/PROXMOX_VM_GUIDE.md" \
  "${STAGING_DIR}/docs/"
cp -a -- "${SOURCE_DIR}/deploy/harnesshub.service" "${STAGING_DIR}/deploy/"
"${NPM_BIN}" --prefix "${STAGING_DIR}" ci --omit=dev --ignore-scripts

if [[ -d "${APP_DIR}" ]]; then
  BACKUP_DIR="${APP_DIR}.previous.$(date -u +%Y%m%dT%H%M%SZ).$$"
  mv -- "${APP_DIR}" "${BACKUP_DIR}"
  printf 'Previous application preserved at %s\n' "${BACKUP_DIR}"
fi
mv -- "${STAGING_DIR}" "${APP_DIR}"
STAGING_DIR=""
chown -R root:root "${APP_DIR}"

runuser -u "${APP_USER}" -- env \
  HOME="${STATE_DIR}" \
  "${NPM_BIN}" install \
  --prefix "${STATE_DIR}/tools" \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  "${PI_PACKAGE}"

TEMPORARY_SERVICE="$(mktemp "${CONFIG_DIR}/harnesshub.service.XXXXXX")"
sed "s|^ExecStart=.*|ExecStart=${NODE_BIN} ${APP_DIR}/dist/main.js|" \
  "${APP_DIR}/deploy/harnesshub.service" >"${TEMPORARY_SERVICE}"
install -o root -g root -m 0644 "${TEMPORARY_SERVICE}" "${SERVICE_FILE}"
rm -f -- "${TEMPORARY_SERVICE}"
systemctl daemon-reload

if [[ "${NO_START}" == false ]]; then
  systemctl enable harnesshub.service
  systemctl restart harnesshub.service
  systemctl --no-pager --full status harnesshub.service || {
    journalctl -u harnesshub.service -n 50 --no-pager >&2
    exit 1
  }
else
  printf 'Service installation complete; start it later with: sudo systemctl enable --now harnesshub\n'
fi

if [[ "${NO_PI_LOGIN}" == false && -t 0 ]]; then
  printf '\nPi is installed. Native provider login still requires your approval.\n'
  read -r -p "Open Pi login now? [Y/n]: " login_choice
  if [[ ! "${login_choice}" =~ ^[Nn]$ ]]; then
    printf 'In Pi, run /login and exit when authentication is complete.\n'
    runuser -u "${APP_USER}" -- env \
      --chdir="${STATE_DIR}" \
      -u AI_AGENT \
      -u PI_CODING_AGENT \
      -u PI_SESSION_ID \
      -u PI_SESSION_FILE \
      -u PI_PROVIDER \
      -u PI_MODEL \
      -u PI_REASONING_LEVEL \
      HOME="${STATE_DIR}" \
      PI_CODING_AGENT_DIR="${STATE_DIR}/pi-agent" \
      "${STATE_DIR}/tools/node_modules/.bin/pi" \
      --no-session \
      --no-approve
  fi
fi

cat <<EOF

HarnessHub installation completed.

Next steps in Discord:
  1. Run /setup in the configured guild.
  2. In #workspace-management, run /harness detect and /harness auth.
  3. Run /project create, then send a message in the project channel.

Logs:
  sudo journalctl -u harnesshub -f
EOF

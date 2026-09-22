#!/bin/sh
set -eu

readonly PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export PATH
umask 077

readonly DEPLOY_USER='omnilodge-deploy'
readonly OPT_ROOT='/opt/omnilodge'
readonly ETC_ROOT='/etc/omnilodge'
readonly STATE_ROOT='/var/lib/omnilodge'
readonly CACHE_ROOT='/var/cache/omnilodge'
readonly LIBEXEC_ROOT='/usr/local/libexec/omnilodge'
readonly CONTROL_PLANE_ROOT='/usr/local/libexec/omnilodge/control-plane'
readonly DOC_ROOT='/usr/local/share/doc/omnilodge-production'
readonly SSHD_TARGET='/etc/ssh/sshd_config.d/90-omnilodge-deploy.conf'
readonly SUDOERS_TARGET='/etc/sudoers.d/omnilodge-deploy'
readonly AUTHORIZED_KEYS_DIR='/etc/ssh/authorized_keys'
readonly AUTHORIZED_KEYS_TARGET='/etc/ssh/authorized_keys/omnilodge-deploy'
PM2_UNIT_FRAGMENT=''

case "$0" in
  /*) SCRIPT_ENTRY=$0 ;;
  */*) SCRIPT_ENTRY=$PWD/$0 ;;
  *) SCRIPT_ENTRY=$(command -v "$0" 2>/dev/null || true) ;;
esac
SCRIPT_PATH=$(readlink -f "$SCRIPT_ENTRY" 2>/dev/null || true)
if [ -z "$SCRIPT_PATH" ]; then
  printf '%s\n' 'bootstrap refused: bootstrap entry path cannot be resolved' >&2
  exit 1
fi
SOURCE_ROOT=$(CDPATH= cd -P "$(dirname "$SCRIPT_PATH")" && pwd)
readonly SOURCE_ROOT

MODE='check'
if [ "$#" -gt 1 ]; then
  printf '%s\n' 'Usage: bootstrap-host.sh [--check|--dry-run|--install]' >&2
  exit 64
fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    --check) MODE='check' ;;
    --dry-run) MODE='dry-run' ;;
    --install) MODE='install' ;;
    *)
      printf '%s\n' 'Usage: bootstrap-host.sh [--check|--dry-run|--install]' >&2
      exit 64
      ;;
  esac
fi
readonly MODE

note() {
  printf '%s\n' "$*"
}

die() {
  printf 'bootstrap refused: %s\n' "$*" >&2
  exit 1
}

source_file() {
  printf '%s/%s\n' "$SOURCE_ROOT" "$1"
}

repository_file() {
  repository_candidate=$SOURCE_ROOT/../../$1
  repository_resolved=$(readlink -f "$repository_candidate" 2>/dev/null || true)
  [ -n "$repository_resolved" ] || die "repository asset path cannot be resolved: $1"
  printf '%s\n' "$repository_resolved"
}

BOOTSTRAP_LIBRARY=$(source_file lib/bootstrap-functions.sh)
[ -f "$BOOTSTRAP_LIBRARY" ] && [ ! -L "$BOOTSTRAP_LIBRARY" ] \
  || die 'bootstrap function library is missing or is a symbolic link'

# Never evaluate repository-owned helper code with root privileges until the
# executing script, helper, and every canonical ancestor are root-owned and
# not writable by group or world. This check is intentionally self-contained.
bootstrap_assert_trusted_source_path() {
  bootstrap_atsp_path=$1
  [ -e "$bootstrap_atsp_path" ] || die "trusted source path is missing: $bootstrap_atsp_path"
  [ ! -L "$bootstrap_atsp_path" ] || die "trusted source path is a symbolic link: $bootstrap_atsp_path"
  bootstrap_atsp_metadata=$(stat -c '%u:%g:%a' "$bootstrap_atsp_path") \
    || die "trusted source metadata cannot be read: $bootstrap_atsp_path"
  bootstrap_atsp_uid=${bootstrap_atsp_metadata%%:*}
  bootstrap_atsp_remainder=${bootstrap_atsp_metadata#*:}
  bootstrap_atsp_gid=${bootstrap_atsp_remainder%%:*}
  bootstrap_atsp_mode=${bootstrap_atsp_remainder#*:}
  [ "$bootstrap_atsp_uid:$bootstrap_atsp_gid" = '0:0' ] \
    || die "trusted source path is not root-owned: $bootstrap_atsp_path"
  bootstrap_atsp_permissions=$((0$bootstrap_atsp_mode))
  [ $((bootstrap_atsp_permissions & 0022)) -eq 0 ] \
    || die "trusted source path is group/world writable: $bootstrap_atsp_path"
}

bootstrap_assert_trusted_source_chain() {
  bootstrap_atsc_path=$1
  while :; do
    bootstrap_assert_trusted_source_path "$bootstrap_atsc_path"
    [ "$bootstrap_atsc_path" = '/' ] && break
    bootstrap_atsc_path=$(dirname "$bootstrap_atsc_path")
  done
}

if [ "$(id -u)" -eq 0 ]; then
  bootstrap_assert_trusted_source_chain "$SCRIPT_PATH"
  bootstrap_assert_trusted_source_chain "$BOOTSTRAP_LIBRARY"
fi
# shellcheck source=lib/bootstrap-functions.sh
. "$BOOTSTRAP_LIBRARY"

require_source_file() {
  file_path=$(source_file "$1")
  [ -f "$file_path" ] || die "missing source asset: $1"
  [ ! -L "$file_path" ] || die "source asset is a symbolic link: $1"
}

require_repository_file() {
  file_path=$(repository_file "$1")
  [ -f "$file_path" ] || die "missing repository asset: $1"
  [ ! -L "$file_path" ] || die "repository asset is a symbolic link: $1"
}

mode_of() { omni_mode_of "$@"; }
uid_of() { omni_uid_of "$@"; }
gid_of() { omni_gid_of "$@"; }
assert_no_symlink_components() { omni_assert_no_symlink_components "$@"; }
assert_root_controlled_existing() { omni_assert_root_controlled_existing "$@"; }
assert_exact_file() { omni_assert_exact_file "$@"; }
assert_exact_directory() { omni_assert_exact_directory "$@"; }

find_command() {
  command_name=$1
  fallback=$2
  resolved=$(command -v "$command_name" 2>/dev/null || true)
  if [ -z "$resolved" ] && [ -x "$fallback" ]; then
    resolved=$fallback
  fi
  printf '%s\n' "$resolved"
}

validate_policy_file() {
  policy_path=$1
  [ -f "$policy_path" ] || die "deployment policy is missing: $policy_path"
  node_path=$(find_command node /usr/bin/node)
  [ -n "$node_path" ] || die 'Node.js is required to validate the deployment policy'
  "$node_path" -e '
    const fs = require("node:fs");
    const policyPath = process.argv[1];
    const actual = fs.readFileSync(policyPath);
    const modes = ["disabled", "manual", "automatic"];
    const expected = modes.map((deploymentMode) => Buffer.from(`${JSON.stringify({ schemaVersion: 1, deploymentMode }, null, 2)}\n`, "utf8"));
    if (!expected.some((candidate) => candidate.equals(actual))) process.exit(1);
  ' "$policy_path" || die "deployment policy is not canonical or has an unsupported mode: $policy_path"
}

validate_toolchain() {
  toolchain_requirement=${1:-optional}
  if [ ! -x /usr/bin/node ] || [ ! -x /usr/bin/npm ]; then
    if [ "$MODE" = 'install' ] || [ "$toolchain_requirement" = 'required' ]; then
      die 'the pinned /usr/bin/node and /usr/bin/npm runtime is required'
    fi
    note 'warning: skipped pinned production toolchain validation on this machine'
    return 0
  fi
  node_version=$(/usr/bin/node --version)
  npm_version=$(/usr/bin/npm --version)
  if [ "$node_version" != 'v22.23.2' ] || [ "$npm_version" != '10.9.8' ]; then
    if [ "$MODE" = 'install' ] || [ "$toolchain_requirement" = 'required' ]; then
      die 'production requires /usr/bin/node 22.23.2 and /usr/bin/npm 10.9.8'
    fi
    note 'warning: this machine does not have the pinned production Node/npm pair'
  fi
}

validate_pm2_service() {
  pm2_validation_required='false'
  if [ "$MODE" = 'install' ] \
    || [ -e /etc/systemd/system/pm2-root.service.d/20-omnilodge-deploy-recovery.conf ] \
    || [ -L /etc/systemd/system/pm2-root.service.d/20-omnilodge-deploy-recovery.conf ]; then
    pm2_validation_required='true'
  fi
  systemctl_path=$(find_command systemctl /usr/bin/systemctl)
  if [ -z "$systemctl_path" ]; then
    [ "$pm2_validation_required" != 'true' ] \
      || die 'systemctl is required to verify the existing pm2-root.service'
    note 'warning: skipped PM2 service identity validation on this machine'
    return 0
  fi
  if [ "$pm2_validation_required" = 'true' ]; then
    pm2_load_state=$("$systemctl_path" show --property=LoadState --value pm2-root.service 2>/dev/null || true)
    [ "$pm2_load_state" = 'loaded' ] || die 'the expected existing pm2-root.service is not loaded'
    PM2_UNIT_FRAGMENT=$("$systemctl_path" show --property=FragmentPath --value pm2-root.service 2>/dev/null || true)
    case "$PM2_UNIT_FRAGMENT" in
      /*) ;;
      *) die 'the existing pm2-root.service does not have an absolute fragment path' ;;
    esac
    [ -f "$PM2_UNIT_FRAGMENT" ] && [ ! -L "$PM2_UNIT_FRAGMENT" ] \
      || die 'the existing pm2-root.service fragment is not a regular root-controlled file'
    omni_assert_root_controlled_ancestors "$(dirname "$PM2_UNIT_FRAGMENT")"
    assert_root_controlled_existing "$PM2_UNIT_FRAGMENT"
    pm2_service_user=$("$systemctl_path" show --property=User --value pm2-root.service 2>/dev/null || true)
    pm2_service_group=$("$systemctl_path" show --property=Group --value pm2-root.service 2>/dev/null || true)
    case "$pm2_service_user" in ''|root) ;; *) die 'pm2-root.service does not run as root' ;; esac
    case "$pm2_service_group" in ''|root) ;; *) die 'pm2-root.service does not run with the root group' ;; esac
  fi
}

validate_external_authorized_keys() {
  if [ ! -e "$AUTHORIZED_KEYS_TARGET" ] && [ ! -L "$AUTHORIZED_KEYS_TARGET" ]; then
    [ "$MODE" != 'install' ] || die "stage the retained public key at $AUTHORIZED_KEYS_TARGET before --install"
    note "warning: the root-owned deployment AuthorizedKeysFile is not staged: $AUTHORIZED_KEYS_TARGET"
    return 0
  fi
  assert_exact_directory "$AUTHORIZED_KEYS_DIR" '755'
  assert_exact_file "$AUTHORIZED_KEYS_TARGET" '644'
  omni_assert_root_controlled_ancestors "$AUTHORIZED_KEYS_TARGET"
  [ -s "$AUTHORIZED_KEYS_TARGET" ] || die 'the root-owned deployment AuthorizedKeysFile is empty'
  ssh_keygen_path=$(find_command ssh-keygen /usr/bin/ssh-keygen)
  if [ -z "$ssh_keygen_path" ]; then
    [ "$MODE" != 'install' ] || die 'ssh-keygen is required to validate the retained public key file'
    note 'warning: skipped retained public-key validation because ssh-keygen is unavailable'
    return 0
  fi
  "$ssh_keygen_path" -l -f "$AUTHORIZED_KEYS_TARGET" >/dev/null \
    || die 'the root-owned deployment AuthorizedKeysFile is invalid'
  awk '
    /^[[:space:]]*(#|$)/ { next }
    {
      if ($1 != "ssh-ed25519" || $2 !~ /^[A-Za-z0-9+\/=]+$/) exit 1
      count += 1
    }
    END { if (count != 1) exit 1 }
  ' "$AUTHORIZED_KEYS_TARGET" \
    || die 'the root-owned deployment AuthorizedKeysFile must contain exactly one Ed25519 key'
}

validate_deploy_account_scope() {
  deploy_sudo_requirement=${1:-optional}
  if ! command -v id >/dev/null 2>&1 || ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    if [ "$MODE" = 'install' ] || [ "$deploy_sudo_requirement" = 'required' ]; then
      die "the existing $DEPLOY_USER account is required"
    fi
    note "warning: existing $DEPLOY_USER account was not found on this machine"
    return 0
  fi
  deploy_uid=$(id -u "$DEPLOY_USER")
  [ "$deploy_uid" -ne 0 ] || die 'deployment account must not be root'
  deploy_groups=$(id -Gn "$DEPLOY_USER")
  for deploy_group in $deploy_groups; do
    [ "$deploy_group" = "$DEPLOY_USER" ] \
      || die "deployment account has an unexpected supplementary group: $deploy_group"
  done

  if [ "$MODE" != 'install' ] && [ "$deploy_sudo_requirement" != 'required' ]; then
    return 0
  fi
  sudo_path=$(find_command sudo /usr/bin/sudo)
  [ -n "$sudo_path" ] || die 'sudo is required to audit the deployment account grants'
  sudo_listing=$(mktemp)
  trap 'rm -f "$sudo_listing"' EXIT HUP INT TERM
  LC_ALL=C COLUMNS=100000 "$sudo_path" -n -l -U "$DEPLOY_USER" >"$sudo_listing" 2>/dev/null || true
  awk -v requirement="$deploy_sudo_requirement" '
    /^User .* may run the following commands on .*:$/ {
      commands = 1
      next
    }
    commands && /^[[:space:]]*$/ { next }
    commands {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      gsub(/\\"/, "\"", line)
      if (line != "(root) NOPASSWD: /usr/local/sbin/omnilodge-deploy \"\"") exit 1
      count += 1
    }
    END {
      if (count > 1) exit 1
      if (requirement == "required" && count != 1) exit 1
    }
  ' "$sudo_listing" || die 'deployment account has an unexpected or duplicate sudo grant'
  rm -f "$sudo_listing"
  trap - EXIT HUP INT TERM
}

validate_source_assets() {
  for relative_path in \
    bootstrap-host.sh \
    bootstrap-primitives.test.sh \
    config/deploy-policy.json \
    config/backend.env \
    config/ui-server.env \
    ssh/90-omnilodge-deploy.conf \
    sudoers/omnilodge-deploy \
    bin/ssh-gateway \
    bin/omnilodge-capture-legacy-baseline \
    bin/omnilodge-deploy \
    bin/omnilodge-deploy-worker \
    bin/omnilodge-deploy-recover \
    bin/runtime-launcher.mjs \
    lib/bootstrap-functions.sh \
    systemd/omnilodge-deploy-worker@.service \
    systemd/omnilodge-deploy-recovery.service \
    systemd/pm2-root-omnilodge-deploy.conf \
    pm2/ecosystem.production.json \
    logrotate/omnilodge \
    README.md
  do
    require_source_file "$relative_path"
    if [ "$(id -u)" -eq 0 ]; then
      omni_assert_root_controlled_ancestors "$(source_file "$relative_path")"
    fi
  done

  for relative_path in \
    ops/production/libexec/deploy/activation-state-store.mjs \
    ops/production/libexec/deploy/activation-orchestrator.mjs \
    ops/production/libexec/deploy/activation-pointer-switcher.mjs \
    ops/production/libexec/deploy/audit-log.mjs \
    ops/production/libexec/deploy/backup-gate.mjs \
    ops/production/libexec/deploy/canonical-json.mjs \
    ops/production/libexec/deploy/capacity.mjs \
    ops/production/libexec/deploy/constants.mjs \
    ops/production/libexec/deploy/capture-legacy-baseline-cli.mjs \
    ops/production/libexec/deploy/deployment-flock.mjs \
    ops/production/libexec/deploy/index.mjs \
    ops/production/libexec/deploy/legacy-baseline.mjs \
    ops/production/libexec/deploy/pm2-service-controller.mjs \
    ops/production/libexec/deploy/public-smoke-verifier.mjs \
    ops/production/libexec/deploy/release-preparation.mjs \
    ops/production/libexec/deploy/request-store.mjs \
    ops/production/libexec/deploy/secure-filesystem.mjs \
    ops/production/libexec/deploy/state-schema.mjs \
    ops/production/libexec/deploy/submit-request.mjs \
    ops/production/libexec/deploy/worker.mjs \
    scripts/deploy/extract-github-artifact.mjs \
    scripts/deploy/github-release-evidence.mjs \
    scripts/deploy/host/deploy-policy.mjs \
    scripts/deploy/host/protocol.mjs \
    scripts/deploy/host/protocol-v2.mjs \
    scripts/deploy/host/request-receiver.mjs \
    scripts/deploy/host/state.mjs \
    scripts/release/lib.mjs
  do
    require_repository_file "$relative_path"
    if [ "$(id -u)" -eq 0 ]; then
      omni_assert_root_controlled_ancestors "$(repository_file "$relative_path")"
    fi
  done

  validate_policy_file "$(source_file config/deploy-policy.json)"

  shell_path=$(find_command sh /bin/sh)
  if [ -n "$shell_path" ]; then
    "$shell_path" -n \
      "$(source_file bootstrap-host.sh)" \
      "$(source_file bin/ssh-gateway)" \
      "$(source_file bin/omnilodge-capture-legacy-baseline)" \
      "$(source_file bin/omnilodge-deploy)" \
      "$(source_file bin/omnilodge-deploy-worker)" \
      "$(source_file bin/omnilodge-deploy-recover)" \
      "$(source_file lib/bootstrap-functions.sh)" \
      "$(source_file bootstrap-primitives.test.sh)"
  elif [ "$MODE" = 'install' ]; then
    die 'a POSIX shell is required to install the host assets'
  else
    note 'warning: skipped shell syntax checks because sh is unavailable'
  fi

  node_path=$(find_command node /usr/bin/node)
  if [ -n "$node_path" ]; then
    "$node_path" --check "$(source_file bin/runtime-launcher.mjs)"
    "$node_path" -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" \
      "$(source_file pm2/ecosystem.production.json)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/activation-state-store.mjs)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/activation-orchestrator.mjs)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/activation-pointer-switcher.mjs)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/backup-gate.mjs)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/capture-legacy-baseline-cli.mjs)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/legacy-baseline.mjs)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/pm2-service-controller.mjs)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/public-smoke-verifier.mjs)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/submit-request.mjs)"
    "$node_path" --check "$(repository_file ops/production/libexec/deploy/worker.mjs)"
  elif [ "$MODE" = 'install' ]; then
    die 'Node.js is required to install the host assets'
  else
    note 'warning: skipped JavaScript syntax checks because node is unavailable'
  fi
}

validate_sudoers_source() {
  visudo_path=$(find_command visudo /usr/sbin/visudo)
  if [ -z "$visudo_path" ]; then
    [ "$MODE" != 'install' ] || die 'visudo is required before installing the sudo boundary'
    note 'warning: skipped sudoers validation because visudo is unavailable'
    return 0
  fi
  "$visudo_path" -cf "$(source_file sudoers/omnilodge-deploy)" >/dev/null
  if [ "$MODE" = 'install' ]; then
    "$visudo_path" -cf /etc/sudoers >/dev/null
  fi
}

validate_sshd_source() {
  sshd_path=$(find_command sshd /usr/sbin/sshd)
  if [ -z "$sshd_path" ] || [ ! -f /etc/ssh/sshd_config ]; then
    [ "$MODE" != 'install' ] || die 'sshd and /etc/ssh/sshd_config are required before installing the SSH boundary'
    note 'warning: skipped sshd validation because the server configuration is unavailable'
    return 0
  fi

  candidate=$(mktemp)
  rendered=$(mktemp)
  trap 'rm -f "$candidate" "$rendered"' EXIT HUP INT TERM
  cat /etc/ssh/sshd_config >"$candidate"
  printf '\nMatch all\nInclude %s\n' "$(source_file ssh/90-omnilodge-deploy.conf)" >>"$candidate"
  "$sshd_path" -t -f "$candidate"
  "$sshd_path" -T \
    -C "user=$DEPLOY_USER,host=localhost,addr=127.0.0.1" \
    -f "$candidate" >"$rendered"
  grep -qx 'forcecommand /usr/local/libexec/omnilodge/ssh-gateway' "$rendered" \
    || die 'candidate sshd configuration does not force the deployment gateway'
  grep -qx 'permittty no' "$rendered" || die 'candidate sshd configuration permits a TTY'
  grep -qx 'allowagentforwarding no' "$rendered" || die 'candidate sshd configuration permits agent forwarding'
  grep -qx 'allowtcpforwarding no' "$rendered" || die 'candidate sshd configuration permits TCP forwarding'
  grep -qx 'allowstreamlocalforwarding no' "$rendered" \
    || die 'candidate sshd configuration permits stream-local forwarding'
  grep -qx 'x11forwarding no' "$rendered" || die 'candidate sshd configuration permits X11 forwarding'
  grep -qx 'permittunnel no' "$rendered" || die 'candidate sshd configuration permits tunnels'
  grep -qx 'permitopen none' "$rendered" || die 'candidate sshd configuration permits forwarding destinations'
  grep -qx 'permitlisten none' "$rendered" || die 'candidate sshd configuration permits remote listeners'
  grep -qx 'passwordauthentication no' "$rendered" || die 'candidate sshd configuration permits passwords'
  grep -qx 'pubkeyauthentication yes' "$rendered" \
    || die 'candidate sshd configuration does not permit public-key authentication'
  grep -qx 'authenticationmethods publickey' "$rendered" \
    || die 'candidate sshd configuration does not require public-key authentication'
  grep -qx 'authorizedkeyscommand none' "$rendered" \
    || die 'candidate sshd configuration permits an alternate authorized-keys command'
  grep -qx 'trustedusercakeys none' "$rendered" \
    || die 'candidate sshd configuration permits a trusted user CA as an alternate key source'
  grep -qx 'permituserenvironment no' "$rendered" \
    || die 'candidate sshd configuration permits key-controlled user environment values'
  grep -qx 'authorizedkeysfile /etc/ssh/authorized_keys/omnilodge-deploy' "$rendered" \
    || die 'candidate sshd configuration does not use the root-owned AuthorizedKeysFile'
  rm -f "$candidate" "$rendered"
  trap - EXIT HUP INT TERM
}

assert_installed_sshd_effective() {
  installed_sshd_path=$(find_command sshd /usr/sbin/sshd)
  [ -n "$installed_sshd_path" ] && [ -f /etc/ssh/sshd_config ] \
    || die 'installed sshd configuration cannot be validated'
  installed_rendered=$(mktemp)
  trap 'rm -f "$installed_rendered"' EXIT HUP INT TERM
  "$installed_sshd_path" -t -f /etc/ssh/sshd_config
  "$installed_sshd_path" -T \
    -C "user=$DEPLOY_USER,host=localhost,addr=127.0.0.1" \
    -f /etc/ssh/sshd_config >"$installed_rendered"
  grep -qx 'forcecommand /usr/local/libexec/omnilodge/ssh-gateway' "$installed_rendered" \
    || die 'installed sshd configuration does not force the deployment gateway'
  grep -qx 'permittty no' "$installed_rendered" || die 'installed sshd configuration permits a TTY'
  grep -qx 'allowagentforwarding no' "$installed_rendered" || die 'installed sshd configuration permits agent forwarding'
  grep -qx 'allowtcpforwarding no' "$installed_rendered" || die 'installed sshd configuration permits TCP forwarding'
  grep -qx 'allowstreamlocalforwarding no' "$installed_rendered" \
    || die 'installed sshd configuration permits stream-local forwarding'
  grep -qx 'x11forwarding no' "$installed_rendered" || die 'installed sshd configuration permits X11 forwarding'
  grep -qx 'permittunnel no' "$installed_rendered" || die 'installed sshd configuration permits tunnels'
  grep -qx 'permitopen none' "$installed_rendered" || die 'installed sshd configuration permits forwarding destinations'
  grep -qx 'permitlisten none' "$installed_rendered" || die 'installed sshd configuration permits remote listeners'
  grep -qx 'passwordauthentication no' "$installed_rendered" || die 'installed sshd configuration permits passwords'
  grep -qx 'pubkeyauthentication yes' "$installed_rendered" \
    || die 'installed sshd configuration does not permit public-key authentication'
  grep -qx 'authenticationmethods publickey' "$installed_rendered" \
    || die 'installed sshd configuration does not require public-key authentication'
  grep -qx 'authorizedkeyscommand none' "$installed_rendered" \
    || die 'installed sshd configuration permits an alternate authorized-keys command'
  grep -qx 'trustedusercakeys none' "$installed_rendered" \
    || die 'installed sshd configuration permits a trusted user CA as an alternate key source'
  grep -qx 'permituserenvironment no' "$installed_rendered" \
    || die 'installed sshd configuration permits key-controlled user environment values'
  grep -qx 'authorizedkeysfile /etc/ssh/authorized_keys/omnilodge-deploy' "$installed_rendered" \
    || die 'installed sshd configuration does not use the root-owned AuthorizedKeysFile'
  rm -f "$installed_rendered"
  trap - EXIT HUP INT TERM
}

validate_prerequisites() {
  if [ "$MODE" = 'install' ] && [ "$(id -u)" -ne 0 ]; then
    die '--install must run as root'
  fi
  validate_source_assets
  validate_toolchain
  validate_pm2_service
  validate_external_authorized_keys
  validate_deploy_account_scope
  validate_sudoers_source
  validate_sshd_source
  if [ "$MODE" = 'install' ] \
    && { [ -e "$SUDOERS_TARGET" ] || [ -L "$SUDOERS_TARGET" ]; }; then
    # A pre-existing sudo grant is safe to retain only when the host's real
    # sshd include graph already enforces the reviewed forced-command boundary.
    assert_installed_sshd_effective
  fi
}

ensure_directory() { omni_ensure_directory "$@"; }
atomic_install() { omni_atomic_install "$@"; }
install_if_missing() { omni_install_if_missing "$@"; }
touch_if_missing() { omni_touch_if_missing "$@"; }

show_plan() {
  note 'Validated the repository assets. A real install would:'
  note "  - create root-owned release paths below $OPT_ROOT"
  note "  - create root-owned configuration below $ETC_ROOT"
  note "  - create persistent state below $STATE_ROOT"
  note '  - install a forced-command SSH rule and an exact no-argument sudo rule'
  note '  - install disabled deploy/worker/recovery executables and inactive systemd units'
  note '  - install the root-only legacy baseline capture command'
  note '  - install, but not start, the stable PM2 ecosystem and runtime launcher'
  note '  - leave the existing deployment key, live checkout, PM2 processes, and services unchanged'
}

validate_installed() {
  if [ ! -e "$OPT_ROOT" ] && [ ! -L "$OPT_ROOT" ] \
    && [ ! -e "$ETC_ROOT" ] && [ ! -L "$ETC_ROOT" ] \
    && [ ! -e "$STATE_ROOT" ] && [ ! -L "$STATE_ROOT" ] \
    && [ ! -e "$LIBEXEC_ROOT" ] && [ ! -L "$LIBEXEC_ROOT" ] \
    && [ ! -e "$SSHD_TARGET" ] && [ ! -L "$SSHD_TARGET" ] \
    && [ ! -e "$SUDOERS_TARGET" ] && [ ! -L "$SUDOERS_TARGET" ] \
    && [ ! -e /usr/local/sbin/omnilodge-capture-legacy-baseline ] && [ ! -L /usr/local/sbin/omnilodge-capture-legacy-baseline ] \
    && [ ! -e /usr/local/sbin/omnilodge-deploy ] && [ ! -L /usr/local/sbin/omnilodge-deploy ] \
    && [ ! -e /etc/systemd/system/omnilodge-deploy-worker@.service ] \
    && [ ! -L /etc/systemd/system/omnilodge-deploy-worker@.service ] \
    && [ ! -e /etc/systemd/system/omnilodge-deploy-recovery.service ] \
    && [ ! -L /etc/systemd/system/omnilodge-deploy-recovery.service ] \
    && [ ! -e /etc/systemd/system/pm2-root.service.d/20-omnilodge-deploy-recovery.conf ] \
    && [ ! -L /etc/systemd/system/pm2-root.service.d/20-omnilodge-deploy-recovery.conf ] \
    && [ ! -e /etc/logrotate.d/omnilodge ] && [ ! -L /etc/logrotate.d/omnilodge ] \
    && [ ! -e "$DOC_ROOT" ] && [ ! -L "$DOC_ROOT" ]; then
    return 0
  fi

  assert_exact_directory "$OPT_ROOT" '755'
  assert_exact_directory "$OPT_ROOT/incoming" '700'
  assert_exact_directory "$OPT_ROOT/releases" '755'
  assert_exact_directory "$OPT_ROOT/dependencies" '755'
  assert_exact_directory "$OPT_ROOT/dependencies/backend" '755'
  assert_exact_directory "$OPT_ROOT/dependencies/ui-server" '755'
  assert_exact_directory "$ETC_ROOT" '700'
  assert_exact_directory "$ETC_ROOT/tls" '700'
  assert_exact_directory "$STATE_ROOT" '700'
  for installed_directory in \
    uploads uploads/night-reports uploads/profile-photos \
    runtime runtime/backend runtime/error-monitoring \
    logs logs/backend logs/ui-server logs/pm2 logs/deploy \
    source-maps deploy deploy/requests deploy/requests/pending \
    deploy/requests/running deploy/requests/finished deploy/requests/nonces \
    deploy/staging deploy/state deploy/audit deploy/audit/segments
  do
    assert_exact_directory "$STATE_ROOT/$installed_directory" '700'
  done
  assert_exact_directory "$CACHE_ROOT" '700'
  assert_exact_directory "$CACHE_ROOT/npm" '700'
  assert_exact_directory "$CACHE_ROOT/puppeteer" '700'
  assert_exact_directory "$LIBEXEC_ROOT" '755'
  assert_exact_directory "$CONTROL_PLANE_ROOT" '755'
  assert_exact_directory "$CONTROL_PLANE_ROOT/ops" '755'
  assert_exact_directory "$CONTROL_PLANE_ROOT/ops/production" '755'
  assert_exact_directory "$CONTROL_PLANE_ROOT/ops/production/libexec" '755'
  assert_exact_directory "$CONTROL_PLANE_ROOT/ops/production/libexec/deploy" '755'
  assert_exact_directory "$CONTROL_PLANE_ROOT/scripts" '755'
  assert_exact_directory "$CONTROL_PLANE_ROOT/scripts/deploy" '755'
  assert_exact_directory "$CONTROL_PLANE_ROOT/scripts/deploy/host" '755'
  assert_exact_directory "$CONTROL_PLANE_ROOT/scripts/release" '755'
  assert_exact_directory "$DOC_ROOT" '755'
  assert_exact_directory "$AUTHORIZED_KEYS_DIR" '755'
  assert_exact_directory /etc/systemd/system/pm2-root.service.d '755'

  assert_exact_file "$ETC_ROOT/deploy-policy.json" '600'
  validate_policy_file "$ETC_ROOT/deploy-policy.json"
  assert_exact_file "$ETC_ROOT/backend.env" '600'
  assert_exact_file "$ETC_ROOT/ui-server.env" '600'
  assert_exact_file "$AUTHORIZED_KEYS_TARGET" '644'
  assert_exact_file "$SSHD_TARGET" '644'
  assert_exact_file "$SUDOERS_TARGET" '440'
  assert_exact_file "$LIBEXEC_ROOT/ssh-gateway" '755'
  assert_exact_file "$LIBEXEC_ROOT/runtime-launcher.mjs" '755'
  for installed_control_plane_file in \
    ops/production/libexec/deploy/activation-state-store.mjs \
    ops/production/libexec/deploy/activation-orchestrator.mjs \
    ops/production/libexec/deploy/activation-pointer-switcher.mjs \
    ops/production/libexec/deploy/audit-log.mjs \
    ops/production/libexec/deploy/backup-gate.mjs \
    ops/production/libexec/deploy/canonical-json.mjs \
    ops/production/libexec/deploy/capacity.mjs \
    ops/production/libexec/deploy/constants.mjs \
    ops/production/libexec/deploy/capture-legacy-baseline-cli.mjs \
    ops/production/libexec/deploy/deployment-flock.mjs \
    ops/production/libexec/deploy/index.mjs \
    ops/production/libexec/deploy/legacy-baseline.mjs \
    ops/production/libexec/deploy/pm2-service-controller.mjs \
    ops/production/libexec/deploy/public-smoke-verifier.mjs \
    ops/production/libexec/deploy/release-preparation.mjs \
    ops/production/libexec/deploy/request-store.mjs \
    ops/production/libexec/deploy/secure-filesystem.mjs \
    ops/production/libexec/deploy/state-schema.mjs \
    ops/production/libexec/deploy/submit-request.mjs \
    ops/production/libexec/deploy/worker.mjs \
    scripts/deploy/extract-github-artifact.mjs \
    scripts/deploy/github-release-evidence.mjs \
    scripts/deploy/host/deploy-policy.mjs \
    scripts/deploy/host/protocol.mjs \
    scripts/deploy/host/protocol-v2.mjs \
    scripts/deploy/host/request-receiver.mjs \
    scripts/deploy/host/state.mjs \
    scripts/release/lib.mjs
  do
    assert_exact_file "$CONTROL_PLANE_ROOT/$installed_control_plane_file" '644'
    cmp -s "$(repository_file "$installed_control_plane_file")" "$CONTROL_PLANE_ROOT/$installed_control_plane_file" \
      || die "installed control-plane file differs from the reviewed source: $installed_control_plane_file"
  done
  assert_exact_file /usr/local/sbin/omnilodge-capture-legacy-baseline '755'
  assert_exact_file /usr/local/sbin/omnilodge-deploy '755'
  assert_exact_file /usr/local/sbin/omnilodge-deploy-worker '755'
  assert_exact_file /usr/local/sbin/omnilodge-deploy-recover '755'
  assert_exact_file "$ETC_ROOT/ecosystem.production.json" '644'
  assert_exact_file /etc/systemd/system/omnilodge-deploy-worker@.service '644'
  assert_exact_file /etc/systemd/system/omnilodge-deploy-recovery.service '644'
  assert_exact_file /etc/systemd/system/pm2-root.service.d/20-omnilodge-deploy-recovery.conf '644'
  assert_exact_file /etc/logrotate.d/omnilodge '644'
  assert_exact_file "$DOC_ROOT/README.md" '644'
  assert_exact_file "$STATE_ROOT/logs/backend/error.log" '600'
  assert_exact_file "$STATE_ROOT/logs/backend/combined.log" '600'
  assert_exact_file "$STATE_ROOT/logs/ui-server/error.log" '600'
  assert_exact_file "$STATE_ROOT/logs/ui-server/combined.log" '600'
  assert_exact_file "$STATE_ROOT/logs/deploy/worker.log" '600'

  cmp -s "$(source_file bin/ssh-gateway)" "$LIBEXEC_ROOT/ssh-gateway" \
    || die 'installed SSH gateway differs from the reviewed source'
  cmp -s "$(source_file bin/runtime-launcher.mjs)" "$LIBEXEC_ROOT/runtime-launcher.mjs" \
    || die 'installed runtime launcher differs from the reviewed source'
  cmp -s "$(source_file bin/omnilodge-capture-legacy-baseline)" /usr/local/sbin/omnilodge-capture-legacy-baseline \
    || die 'installed legacy baseline capture command differs from the reviewed source'
  cmp -s "$(source_file bin/omnilodge-deploy)" /usr/local/sbin/omnilodge-deploy \
    || die 'installed deploy entry point differs from the reviewed source'
  cmp -s "$(source_file bin/omnilodge-deploy-worker)" /usr/local/sbin/omnilodge-deploy-worker \
    || die 'installed deploy worker differs from the reviewed source'
  cmp -s "$(source_file bin/omnilodge-deploy-recover)" /usr/local/sbin/omnilodge-deploy-recover \
    || die 'installed recovery gate differs from the reviewed source'
  cmp -s "$(source_file ssh/90-omnilodge-deploy.conf)" "$SSHD_TARGET" \
    || die 'installed SSH Match configuration differs from the reviewed source'
  cmp -s "$(source_file sudoers/omnilodge-deploy)" "$SUDOERS_TARGET" \
    || die 'installed sudo rule differs from the reviewed source'
  cmp -s "$(source_file pm2/ecosystem.production.json)" "$ETC_ROOT/ecosystem.production.json" \
    || die 'installed PM2 ecosystem differs from the reviewed source'
  cmp -s "$(source_file systemd/omnilodge-deploy-worker@.service)" /etc/systemd/system/omnilodge-deploy-worker@.service \
    || die 'installed deployment worker unit differs from the reviewed source'
  cmp -s "$(source_file systemd/omnilodge-deploy-recovery.service)" /etc/systemd/system/omnilodge-deploy-recovery.service \
    || die 'installed recovery unit differs from the reviewed source'
  cmp -s "$(source_file systemd/pm2-root-omnilodge-deploy.conf)" /etc/systemd/system/pm2-root.service.d/20-omnilodge-deploy-recovery.conf \
    || die 'installed PM2 recovery gate differs from the reviewed source'
  cmp -s "$(source_file logrotate/omnilodge)" /etc/logrotate.d/omnilodge \
    || die 'installed logrotate policy differs from the reviewed source'
  cmp -s "$(source_file README.md)" "$DOC_ROOT/README.md" \
    || die 'installed production runbook differs from the reviewed source'

  if [ "$(id -u)" -ne 0 ]; then
    die 'checking installed production assets requires root'
  fi
  validate_toolchain required
  assert_installed_sshd_effective
  installed_visudo_path=$(find_command visudo /usr/sbin/visudo)
  [ -n "$installed_visudo_path" ] || die 'installed sudoers configuration cannot be validated'
  "$installed_visudo_path" -cf "$SUDOERS_TARGET" >/dev/null
  "$installed_visudo_path" -cf /etc/sudoers >/dev/null
  validate_deploy_account_scope required

  installed_systemd_analyze=$(find_command systemd-analyze /usr/bin/systemd-analyze)
  if [ -n "$installed_systemd_analyze" ]; then
    "$installed_systemd_analyze" verify \
      "$PM2_UNIT_FRAGMENT" \
      /etc/systemd/system/omnilodge-deploy-worker@.service \
      /etc/systemd/system/omnilodge-deploy-recovery.service >/dev/null
  fi
  installed_logrotate=$(find_command logrotate /usr/sbin/logrotate)
  if [ -n "$installed_logrotate" ]; then
    "$installed_logrotate" --debug /etc/logrotate.d/omnilodge >/dev/null 2>&1
  fi
}

install_assets() {
  source_directory=$SOURCE_ROOT
  while [ "$source_directory" != '/' ]; do
    assert_root_controlled_existing "$source_directory"
    source_directory=$(dirname "$source_directory")
  done
  assert_root_controlled_existing '/'

  for source_asset in \
    bootstrap-host.sh \
    config/deploy-policy.json \
    config/backend.env \
    config/ui-server.env \
    ssh/90-omnilodge-deploy.conf \
    sudoers/omnilodge-deploy \
    bin/ssh-gateway \
    bin/omnilodge-capture-legacy-baseline \
    bin/omnilodge-deploy \
    bin/omnilodge-deploy-worker \
    bin/omnilodge-deploy-recover \
    bin/runtime-launcher.mjs \
    lib/bootstrap-functions.sh \
    systemd/omnilodge-deploy-worker@.service \
    systemd/omnilodge-deploy-recovery.service \
    systemd/pm2-root-omnilodge-deploy.conf \
    pm2/ecosystem.production.json \
    logrotate/omnilodge \
    README.md
  do
    source_path=$(source_file "$source_asset")
    omni_assert_root_controlled_ancestors "$source_path"
    [ "$(uid_of "$source_path")" = '0' ] || die "install source is not root-owned: $source_asset"
    source_mode=$(mode_of "$source_path")
    source_permissions=$((0$source_mode))
    [ $((source_permissions & 0022)) -eq 0 ] || die "install source is group/world writable: $source_asset"
  done

  for source_asset in \
    ops/production/libexec/deploy/audit-log.mjs \
    ops/production/libexec/deploy/backup-gate.mjs \
    ops/production/libexec/deploy/canonical-json.mjs \
    ops/production/libexec/deploy/capacity.mjs \
    ops/production/libexec/deploy/constants.mjs \
    ops/production/libexec/deploy/deployment-flock.mjs \
    ops/production/libexec/deploy/index.mjs \
    ops/production/libexec/deploy/pm2-service-controller.mjs \
    ops/production/libexec/deploy/public-smoke-verifier.mjs \
    ops/production/libexec/deploy/release-preparation.mjs \
    ops/production/libexec/deploy/request-store.mjs \
    ops/production/libexec/deploy/secure-filesystem.mjs \
    ops/production/libexec/deploy/state-schema.mjs \
    ops/production/libexec/deploy/submit-request.mjs \
    ops/production/libexec/deploy/worker.mjs \
    scripts/deploy/extract-github-artifact.mjs \
    scripts/deploy/github-release-evidence.mjs \
    scripts/deploy/host/deploy-policy.mjs \
    scripts/deploy/host/protocol.mjs \
    scripts/deploy/host/protocol-v2.mjs \
    scripts/deploy/host/request-receiver.mjs \
    scripts/deploy/host/state.mjs \
    scripts/release/lib.mjs
  do
    source_path=$(repository_file "$source_asset")
    omni_assert_root_controlled_ancestors "$source_path"
    [ "$(uid_of "$source_path")" = '0' ] || die "install source is not root-owned: $source_asset"
    source_mode=$(mode_of "$source_path")
    source_permissions=$((0$source_mode))
    [ $((source_permissions & 0022)) -eq 0 ] || die "install source is group/world writable: $source_asset"
  done

  ensure_directory "$OPT_ROOT" 755
  ensure_directory "$OPT_ROOT/incoming" 700
  ensure_directory "$OPT_ROOT/releases" 755
  ensure_directory "$OPT_ROOT/dependencies" 755
  ensure_directory "$OPT_ROOT/dependencies/backend" 755
  ensure_directory "$OPT_ROOT/dependencies/ui-server" 755

  ensure_directory "$ETC_ROOT" 700
  ensure_directory "$ETC_ROOT/tls" 700
  ensure_directory "$AUTHORIZED_KEYS_DIR" 755

  ensure_directory "$STATE_ROOT" 700
  ensure_directory "$STATE_ROOT/uploads" 700
  ensure_directory "$STATE_ROOT/uploads/night-reports" 700
  ensure_directory "$STATE_ROOT/uploads/profile-photos" 700
  ensure_directory "$STATE_ROOT/runtime" 700
  ensure_directory "$STATE_ROOT/runtime/backend" 700
  ensure_directory "$STATE_ROOT/runtime/error-monitoring" 700
  ensure_directory "$STATE_ROOT/logs" 700
  ensure_directory "$STATE_ROOT/logs/backend" 700
  ensure_directory "$STATE_ROOT/logs/ui-server" 700
  ensure_directory "$STATE_ROOT/logs/pm2" 700
  ensure_directory "$STATE_ROOT/logs/deploy" 700
  ensure_directory "$STATE_ROOT/source-maps" 700
  ensure_directory "$STATE_ROOT/deploy" 700
  ensure_directory "$STATE_ROOT/deploy/installer-home" 700
  ensure_directory "$STATE_ROOT/deploy/requests" 700
  ensure_directory "$STATE_ROOT/deploy/requests/pending" 700
  ensure_directory "$STATE_ROOT/deploy/requests/running" 700
  ensure_directory "$STATE_ROOT/deploy/requests/finished" 700
  ensure_directory "$STATE_ROOT/deploy/requests/nonces" 700
  ensure_directory "$STATE_ROOT/deploy/staging" 700
  ensure_directory "$STATE_ROOT/deploy/state" 700
  ensure_directory "$STATE_ROOT/deploy/audit" 700
  ensure_directory "$STATE_ROOT/deploy/audit/segments" 700

  ensure_directory "$CACHE_ROOT" 700
  ensure_directory "$CACHE_ROOT/npm" 700
  ensure_directory "$CACHE_ROOT/puppeteer" 700

  ensure_directory "$LIBEXEC_ROOT" 755
  ensure_directory "$CONTROL_PLANE_ROOT" 755
  ensure_directory "$CONTROL_PLANE_ROOT/ops" 755
  ensure_directory "$CONTROL_PLANE_ROOT/ops/production" 755
  ensure_directory "$CONTROL_PLANE_ROOT/ops/production/libexec" 755
  ensure_directory "$CONTROL_PLANE_ROOT/ops/production/libexec/deploy" 755
  ensure_directory "$CONTROL_PLANE_ROOT/scripts" 755
  ensure_directory "$CONTROL_PLANE_ROOT/scripts/deploy" 755
  ensure_directory "$CONTROL_PLANE_ROOT/scripts/deploy/host" 755
  ensure_directory "$CONTROL_PLANE_ROOT/scripts/release" 755
  ensure_directory "$DOC_ROOT" 755

  install_if_missing "$(source_file config/deploy-policy.json)" "$ETC_ROOT/deploy-policy.json" 600
  install_if_missing "$(source_file config/backend.env)" "$ETC_ROOT/backend.env" 600
  install_if_missing "$(source_file config/ui-server.env)" "$ETC_ROOT/ui-server.env" 600
  validate_policy_file "$ETC_ROOT/deploy-policy.json"

  touch_if_missing "$STATE_ROOT/logs/backend/error.log"
  touch_if_missing "$STATE_ROOT/logs/backend/combined.log"
  touch_if_missing "$STATE_ROOT/logs/ui-server/error.log"
  touch_if_missing "$STATE_ROOT/logs/ui-server/combined.log"
  touch_if_missing "$STATE_ROOT/logs/deploy/worker.log"

  atomic_install "$(source_file bin/ssh-gateway)" "$LIBEXEC_ROOT/ssh-gateway" 755
  atomic_install "$(source_file bin/runtime-launcher.mjs)" "$LIBEXEC_ROOT/runtime-launcher.mjs" 755
  for control_plane_file in \
    ops/production/libexec/deploy/activation-state-store.mjs \
    ops/production/libexec/deploy/activation-orchestrator.mjs \
    ops/production/libexec/deploy/activation-pointer-switcher.mjs \
    ops/production/libexec/deploy/audit-log.mjs \
    ops/production/libexec/deploy/backup-gate.mjs \
    ops/production/libexec/deploy/canonical-json.mjs \
    ops/production/libexec/deploy/capacity.mjs \
    ops/production/libexec/deploy/constants.mjs \
    ops/production/libexec/deploy/capture-legacy-baseline-cli.mjs \
    ops/production/libexec/deploy/deployment-flock.mjs \
    ops/production/libexec/deploy/index.mjs \
    ops/production/libexec/deploy/legacy-baseline.mjs \
    ops/production/libexec/deploy/pm2-service-controller.mjs \
    ops/production/libexec/deploy/public-smoke-verifier.mjs \
    ops/production/libexec/deploy/release-preparation.mjs \
    ops/production/libexec/deploy/request-store.mjs \
    ops/production/libexec/deploy/secure-filesystem.mjs \
    ops/production/libexec/deploy/state-schema.mjs \
    ops/production/libexec/deploy/submit-request.mjs \
    ops/production/libexec/deploy/worker.mjs \
    scripts/deploy/extract-github-artifact.mjs \
    scripts/deploy/github-release-evidence.mjs \
    scripts/deploy/host/deploy-policy.mjs \
    scripts/deploy/host/protocol.mjs \
    scripts/deploy/host/protocol-v2.mjs \
    scripts/deploy/host/request-receiver.mjs \
    scripts/deploy/host/state.mjs \
    scripts/release/lib.mjs
  do
    atomic_install "$(repository_file "$control_plane_file")" "$CONTROL_PLANE_ROOT/$control_plane_file" 644
  done
  atomic_install "$(source_file bin/omnilodge-capture-legacy-baseline)" /usr/local/sbin/omnilodge-capture-legacy-baseline 755
  atomic_install "$(source_file bin/omnilodge-deploy)" /usr/local/sbin/omnilodge-deploy 755
  atomic_install "$(source_file bin/omnilodge-deploy-worker)" /usr/local/sbin/omnilodge-deploy-worker 755
  atomic_install "$(source_file bin/omnilodge-deploy-recover)" /usr/local/sbin/omnilodge-deploy-recover 755
  atomic_install "$(source_file pm2/ecosystem.production.json)" "$ETC_ROOT/ecosystem.production.json" 644
  atomic_install "$(source_file systemd/omnilodge-deploy-worker@.service)" /etc/systemd/system/omnilodge-deploy-worker@.service 644
  atomic_install "$(source_file systemd/omnilodge-deploy-recovery.service)" /etc/systemd/system/omnilodge-deploy-recovery.service 644
  ensure_directory /etc/systemd/system/pm2-root.service.d 755
  atomic_install "$(source_file systemd/pm2-root-omnilodge-deploy.conf)" /etc/systemd/system/pm2-root.service.d/20-omnilodge-deploy-recovery.conf 644
  atomic_install "$(source_file logrotate/omnilodge)" /etc/logrotate.d/omnilodge 644
  atomic_install "$(source_file README.md)" "$DOC_ROOT/README.md" 644

  # Install and prove the effective SSH restriction before granting sudo. If
  # the host does not actually include sshd_config.d, no sudo grant is added.
  atomic_install "$(source_file ssh/90-omnilodge-deploy.conf)" "$SSHD_TARGET" 644
  sshd_path=$(find_command sshd /usr/sbin/sshd)
  "$sshd_path" -t -f /etc/ssh/sshd_config
  assert_installed_sshd_effective

  atomic_install "$(source_file sudoers/omnilodge-deploy)" "$SUDOERS_TARGET" 440
  visudo_path=$(find_command visudo /usr/sbin/visudo)
  "$visudo_path" -cf "$SUDOERS_TARGET" >/dev/null
  "$visudo_path" -cf /etc/sudoers >/dev/null
  validate_deploy_account_scope required

  systemd_analyze=$(find_command systemd-analyze /usr/bin/systemd-analyze)
  if [ -n "$systemd_analyze" ]; then
    "$systemd_analyze" verify \
      "$PM2_UNIT_FRAGMENT" \
      /etc/systemd/system/omnilodge-deploy-worker@.service \
      /etc/systemd/system/omnilodge-deploy-recovery.service >/dev/null
  fi

  logrotate_path=$(find_command logrotate /usr/sbin/logrotate)
  if [ -n "$logrotate_path" ]; then
    "$logrotate_path" --debug /etc/logrotate.d/omnilodge >/dev/null 2>&1
  fi

  validate_installed
  note 'Host assets installed in a fail-closed state.'
  note 'No service was enabled, started, restarted, reloaded, or switched.'
  note "Read $DOC_ROOT/README.md before any separate activation step."
}

validate_prerequisites
if [ "$MODE" != 'install' ]; then
  validate_installed
fi

case "$MODE" in
  check)
    note 'Production bootstrap source and any existing managed files passed checks.'
    ;;
  dry-run)
    show_plan
    ;;
  install)
    install_assets
    ;;
esac

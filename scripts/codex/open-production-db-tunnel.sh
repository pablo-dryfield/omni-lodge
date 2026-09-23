#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-start}"

ssh_host="${PROD_SSH_HOST:-23.95.192.213}"
ssh_user="${PROD_DB_TUNNEL_USER:-omnilodge-codex-db-tunnel}"
remote_db_host="${PROD_DB_REMOTE_HOST:-127.0.0.1}"
remote_db_port="${PROD_DB_REMOTE_PORT:-5432}"
local_db_host="${PROD_DB_LOCAL_HOST:-127.0.0.1}"
local_db_port="${PROD_DB_LOCAL_PORT:-15432}"
db_name="${PROD_DB_NAME:-omni_lodge_db}"
db_user="${PROD_DB_READER_USER:-codex_cloud_reader}"

runtime_user_suffix="${UID:-$(id -u 2>/dev/null || printf user)}"
runtime_root="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/omnilodge-codex-cloud-${runtime_user_suffix}"
key_file="${runtime_root}/prod-db-tunnel-key"
known_hosts_file="${runtime_root}/known_hosts"
control_socket="${runtime_root}/prod-db-tunnel.sock"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment value: ${name}" >&2
    exit 2
  fi
}

prepare_ssh_files() {
  require_env PROD_DB_TUNNEL_SSH_PRIVATE_KEY
  require_env PROD_SSH_KNOWN_HOSTS

  mkdir -p "$runtime_root"
  chmod 700 "$runtime_root" 2>/dev/null || true
  printf '%s\n' "$PROD_DB_TUNNEL_SSH_PRIVATE_KEY" > "$key_file"
  chmod 600 "$key_file" 2>/dev/null || true
  printf '%s\n' "$PROD_SSH_KNOWN_HOSTS" > "$known_hosts_file"
  chmod 600 "$known_hosts_file" 2>/dev/null || true
}

tunnel_target() {
  printf '%s@%s' "$ssh_user" "$ssh_host"
}

is_tunnel_running() {
  [ -S "$control_socket" ] &&
    ssh -S "$control_socket" -o BatchMode=yes -O check "$(tunnel_target)" >/dev/null 2>&1
}

start_tunnel() {
  prepare_ssh_files

  if is_tunnel_running; then
    echo "Production DB tunnel already running on ${local_db_host}:${local_db_port}."
    return 0
  fi

  ssh \
    -i "$key_file" \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o UserKnownHostsFile="$known_hosts_file" \
    -o StrictHostKeyChecking=yes \
    -M \
    -S "$control_socket" \
    -f \
    -N \
    -L "${local_db_host}:${local_db_port}:${remote_db_host}:${remote_db_port}" \
    "$(tunnel_target)"

  echo "Production DB tunnel open on ${local_db_host}:${local_db_port}."
}

check_tunnel() {
  require_env PROD_DB_READER_PASSWORD
  start_tunnel

  if ! command -v psql >/dev/null 2>&1; then
    echo "Tunnel is open. Install psql to run a query check." >&2
    return 0
  fi

  local result
  result="$(
    PGPASSWORD="$PROD_DB_READER_PASSWORD" psql \
      -h "$local_db_host" \
      -p "$local_db_port" \
      -U "$db_user" \
      -d "$db_name" \
      -Atc "select current_user; select current_database();" \
  )"

  echo "Read-only production DB check succeeded:"
  echo "$result"
}

stop_tunnel() {
  prepare_ssh_files

  if is_tunnel_running; then
    ssh -S "$control_socket" -o BatchMode=yes -O exit "$(tunnel_target)" >/dev/null
    echo "Production DB tunnel stopped."
  else
    echo "Production DB tunnel is not running."
  fi
}

case "$command_name" in
  start)
    start_tunnel
    ;;
  check)
    check_tunnel
    ;;
  stop)
    stop_tunnel
    ;;
  status)
    prepare_ssh_files
    if is_tunnel_running; then
      echo "Production DB tunnel is running on ${local_db_host}:${local_db_port}."
    else
      echo "Production DB tunnel is not running."
    fi
    ;;
  *)
    echo "Usage: $0 [start|check|stop|status]" >&2
    exit 2
    ;;
esac

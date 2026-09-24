#!/usr/bin/env bash
set -euo pipefail

command_name="${1:-health}"

persisted_secret_root="${OMNILODGE_CODEX_SECRET_DIR:-${HOME:-/tmp}/.omnilodge-codex-cloud}"

read_required_value() {
  local name="$1"
  local file_name="$2"
  local base64_name="${name}_B64"
  local candidate

  if [ -n "${!name:-}" ]; then
    printf '%s' "${!name}"
    return 0
  fi

  if [ -n "${!base64_name:-}" ]; then
    printf '%s' "${!base64_name}" | base64 -d
    return 0
  fi

  for candidate in "${persisted_secret_root}/${file_name}"; do
    if [ -f "$candidate" ]; then
      cat "$candidate"
      return 0
    fi
  done

  echo "Missing required environment value or secret file: ${name}" >&2
  echo "Expected ${name}, ${base64_name}, or ${persisted_secret_root}/${file_name}" >&2
  exit 2
}

url_encode_identifier() {
  local value="$1"
  if [[ ! "$value" =~ ^[a-z_][a-z0-9_]*$ ]]; then
    echo "Unsafe identifier: ${value}" >&2
    exit 2
  fi
  printf '%s' "$value"
}

read_api_url() {
  local value
  value="$(read_required_value PROD_READ_API_URL prod-read-api-url)"
  value="${value%/}"
  if [[ ! "$value" =~ ^https:// ]]; then
    echo "PROD_READ_API_URL must start with https://" >&2
    exit 2
  fi
  printf '%s' "$value"
}

curl_read_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local api_url
  local connector_token
  local access_client_id
  local access_client_secret

  api_url="$(read_api_url)"
  connector_token="$(read_required_value PROD_READ_API_TOKEN prod-read-api-token)"
  access_client_id="$(read_required_value CLOUDFLARE_ACCESS_CLIENT_ID cloudflare-access-client-id)"
  access_client_secret="$(read_required_value CLOUDFLARE_ACCESS_CLIENT_SECRET cloudflare-access-client-secret)"

  if [ "$method" = "GET" ]; then
    curl --fail --silent --show-error \
      --connect-timeout "${PROD_READ_API_CONNECT_TIMEOUT_SECONDS:-10}" \
      --max-time "${PROD_READ_API_MAX_TIME_SECONDS:-30}" \
      --header "Authorization: Bearer ${connector_token}" \
      --header "CF-Access-Client-Id: ${access_client_id}" \
      --header "CF-Access-Client-Secret: ${access_client_secret}" \
      "${api_url}${path}"
    return 0
  fi

  curl --fail --silent --show-error \
    --connect-timeout "${PROD_READ_API_CONNECT_TIMEOUT_SECONDS:-10}" \
    --max-time "${PROD_READ_API_MAX_TIME_SECONDS:-30}" \
    --request "$method" \
    --header "Authorization: Bearer ${connector_token}" \
    --header "CF-Access-Client-Id: ${access_client_id}" \
    --header "CF-Access-Client-Secret: ${access_client_secret}" \
    --header "Content-Type: application/json" \
    --data "$body" \
    "${api_url}${path}"
}

usage() {
  cat >&2 <<'EOF'
Usage:
  scripts/codex/query-production-read-api.sh health
  scripts/codex/query-production-read-api.sh check
  scripts/codex/query-production-read-api.sh tables
  scripts/codex/query-production-read-api.sh describe <schema> <table>
  scripts/codex/query-production-read-api.sh report open-error-issues [json-body]
  scripts/codex/query-production-read-api.sh read '<json-body>'

Required values:
  PROD_READ_API_URL
  PROD_READ_API_TOKEN
  CLOUDFLARE_ACCESS_CLIENT_ID
  CLOUDFLARE_ACCESS_CLIENT_SECRET

Each value may also be supplied as *_B64 or as a private file under
~/.omnilodge-codex-cloud with the matching names documented in
docs/codex-cloud-setup.md.
EOF
}

case "$command_name" in
  health|check)
    curl_read_api GET /health
    printf '\n'
    ;;
  tables)
    curl_read_api GET /schema/tables
    printf '\n'
    ;;
  describe)
    if [ "$#" -ne 3 ]; then
      usage
      exit 2
    fi
    schema="$(url_encode_identifier "$2")"
    table="$(url_encode_identifier "$3")"
    curl_read_api GET "/schema/tables/${schema}/${table}"
    printf '\n'
    ;;
  report)
    if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
      usage
      exit 2
    fi
    report_name="$2"
    body="${3:-{}}"
    case "$report_name" in
      open-error-issues)
        curl_read_api POST /reports/open-error-issues "$body"
        printf '\n'
        ;;
      *)
        echo "Unsupported report: ${report_name}" >&2
        exit 2
        ;;
    esac
    ;;
  read)
    if [ "$#" -ne 2 ]; then
      usage
      exit 2
    fi
    curl_read_api POST /tables/read "$2"
    printf '\n'
    ;;
  *)
    usage
    exit 2
    ;;
esac

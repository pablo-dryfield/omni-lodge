#!/usr/bin/env bash
set -euo pipefail

api_url="${WHATSAPP_TEST_API_URL:-https://omni-lodge.com/api/integrations/whatsapp/test}"
secret_root="${OMNILODGE_CODEX_SECRET_DIR:-${HOME:-/tmp}/.omnilodge-codex-cloud}"
token="${WHATSAPP_TEST_API_TOKEN:-}"
if [ -z "$token" ] && [ -f "$secret_root/whatsapp-test-api-token" ]; then
  token="$(cat "$secret_root/whatsapp-test-api-token")"
fi
if [ -z "$token" ]; then
  echo 'WHATSAPP_TEST_API_TOKEN or ~/.omnilodge-codex-cloud/whatsapp-test-api-token is required.' >&2
  exit 2
fi

case "${1:-send}" in
  send)
    path='/messages'
    method='POST'
    ;;
  status)
    message_id="${2:-}"
    if [[ ! "$message_id" =~ ^[^[:cntrl:]]{1,256}$ ]]; then
      echo 'A valid message ID is required.' >&2
      exit 2
    fi
    path="/messages/$(printf '%s' "$message_id" | jq -sRr @uri)"
    method='GET'
    ;;
  *)
    echo 'Usage: send-production-whatsapp-test.sh [send | status <message-id>]' >&2
    exit 2
    ;;
esac

curl_args=(
  --fail --silent --show-error
  --request "$method"
  --header "Authorization: Bearer $token"
  --header 'Content-Type: application/json'
)
if [ "$method" = POST ]; then
  curl_args+=(--data '{}')
fi
curl "${curl_args[@]}" "${api_url%/}${path}"
printf '\n'

#!/bin/sh
set -eu

readonly PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export PATH
umask 077

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'SKIP: bootstrap primitive integration test requires an isolated Linux root.'
  exit 77
fi

test_parent=$(readlink -f /root)
test_root=$(mktemp -d "$test_parent/omnilodge-bootstrap-test.XXXXXX")
cleanup() {
  cleanup_target=$(readlink -f "$test_root" 2>/dev/null || true)
  case "$cleanup_target" in
    "$test_parent"/omnilodge-bootstrap-test.*) rm -rf -- "$cleanup_target" ;;
    *) printf '%s\n' 'Refusing unexpected test cleanup path.' >&2 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

die() {
  printf 'test helper refused: %s\n' "$*" >&2
  exit 1
}

script_path=$(readlink -f "$0")
script_root=$(CDPATH= cd -P "$(dirname "$script_path")" && pwd)

pre_source_root="$test_root/pre-source/production"
mkdir -p "$pre_source_root/lib"
cp "$script_root/bootstrap-host.sh" "$pre_source_root/bootstrap-host.sh"
cp "$script_root/lib/bootstrap-functions.sh" "$pre_source_root/lib/bootstrap-functions.sh"
chmod 0755 "$pre_source_root" "$pre_source_root/bootstrap-host.sh"
chmod 0777 "$pre_source_root/lib"
chmod 0644 "$pre_source_root/lib/bootstrap-functions.sh"
pre_source_error="$test_root/pre-source-error"
if sh "$pre_source_root/bootstrap-host.sh" --dry-run >/dev/null 2>"$pre_source_error"; then
  printf '%s\n' 'test helper refused: bootstrap trusted a writable helper parent' >&2
  exit 1
fi
grep -F "trusted source path is group/world writable: $pre_source_root/lib" "$pre_source_error" >/dev/null \
  || die 'bootstrap did not reject the writable helper parent for the expected reason'

# shellcheck source=lib/bootstrap-functions.sh
. "$script_root/lib/bootstrap-functions.sh"

source_file="$test_root/source"
target_directory="$test_root/managed/child"
target_file="$target_directory/installed"
printf '%s\n' 'first version' >"$source_file"
chmod 0600 "$source_file"

omni_ensure_directory "$test_root/managed" 700
omni_ensure_directory "$target_directory" 700
omni_atomic_install "$source_file" "$target_file" 600
[ "$(cat "$target_file")" = 'first version' ]
[ "$(stat -c '%U:%G %a' "$target_file")" = 'root:root 600' ]

printf '%s\n' 'second version' >"$source_file"
omni_atomic_install "$source_file" "$target_file" 600
[ "$(cat "$target_file")" = 'second version' ]

preserved="$target_directory/preserved"
printf '%s\n' 'operator value' >"$preserved"
chmod 0600 "$preserved"
omni_install_if_missing "$source_file" "$preserved" 600
[ "$(cat "$preserved")" = 'operator value' ]

ln -s "$target_file" "$target_directory/unsafe-link"
if (omni_atomic_install "$source_file" "$target_directory/unsafe-link" 600) >/dev/null 2>&1; then
  die 'atomic install accepted a symbolic-link target'
fi

insecure_directory="$test_root/insecure"
mkdir "$insecure_directory"
chmod 0777 "$insecure_directory"
if (omni_atomic_install "$source_file" "$insecure_directory/rejected" 600) >/dev/null 2>&1; then
  die 'atomic install accepted a group/world-writable ancestor'
fi

insecure_source_directory="$test_root/insecure-source"
mkdir "$insecure_source_directory"
chmod 0777 "$insecure_source_directory"
insecure_source="$insecure_source_directory/source"
printf '%s\n' 'untrusted source' >"$insecure_source"
chmod 0600 "$insecure_source"
if (omni_atomic_install "$insecure_source" "$target_directory/rejected-source" 600) >/dev/null 2>&1; then
  die 'atomic install accepted a source below a group/world-writable ancestor'
fi

printf '%s\n' 'bootstrap primitive integration test passed'

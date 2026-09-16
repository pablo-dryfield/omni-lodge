#!/bin/sh

# Shell variables are global unless an implementation-specific `local` is
# used. Every variable here is therefore function-prefixed so nested validation
# cannot change a caller's path between inspection and mutation.

omni_mode_of() {
  stat -c '%a' "$1"
}

omni_uid_of() {
  stat -c '%u' "$1"
}

omni_gid_of() {
  stat -c '%g' "$1"
}

omni_assert_absolute() {
  case "$1" in
    /*) ;;
    *) die "managed path is not absolute: $1" ;;
  esac
  case "$1" in
    *'/../'*|*/..|*'/./'*|*/.) die "managed path is not normalized: $1" ;;
  esac
}

omni_assert_no_symlink_components() {
  omni_ansc_target=$1
  omni_assert_absolute "$omni_ansc_target"
  omni_ansc_current=''
  omni_ansc_old_ifs=$IFS
  IFS='/'
  # shellcheck disable=SC2086
  set -- $omni_ansc_target
  IFS=$omni_ansc_old_ifs
  for omni_ansc_component do
    [ -n "$omni_ansc_component" ] || continue
    omni_ansc_current="$omni_ansc_current/$omni_ansc_component"
    if [ -L "$omni_ansc_current" ]; then
      die "managed path traverses a symbolic link: $omni_ansc_current"
    fi
  done
}

omni_assert_root_controlled_ancestors() {
  omni_arca_target=$1
  omni_assert_absolute "$omni_arca_target"
  omni_arca_current=''
  omni_arca_old_ifs=$IFS
  IFS='/'
  # shellcheck disable=SC2086
  set -- $omni_arca_target
  IFS=$omni_arca_old_ifs
  omni_assert_root_controlled_existing '/'
  for omni_arca_component do
    [ -n "$omni_arca_component" ] || continue
    omni_arca_current="$omni_arca_current/$omni_arca_component"
    [ ! -L "$omni_arca_current" ] \
      || die "managed path traverses a symbolic link: $omni_arca_current"
    if [ -e "$omni_arca_current" ]; then
      omni_assert_root_controlled_existing "$omni_arca_current"
    fi
  done
}

omni_assert_root_controlled_existing() {
  omni_arce_target=$1
  [ -e "$omni_arce_target" ] || return 0
  [ ! -L "$omni_arce_target" ] || die "managed target is a symbolic link: $omni_arce_target"
  [ "$(omni_uid_of "$omni_arce_target")" = '0' ] \
    || die "managed target is not owned by root: $omni_arce_target"
  [ "$(omni_gid_of "$omni_arce_target")" = '0' ] \
    || die "managed target group is not root: $omni_arce_target"
  omni_arce_mode=$(omni_mode_of "$omni_arce_target")
  omni_arce_permissions=$((0$omni_arce_mode))
  [ $((omni_arce_permissions & 0022)) -eq 0 ] \
    || die "managed target is group/world writable: $omni_arce_target"
}

omni_assert_exact_file() {
  omni_aef_target=$1
  omni_aef_expected_mode=$2
  [ -f "$omni_aef_target" ] || die "required installed file is missing: $omni_aef_target"
  omni_assert_root_controlled_ancestors "$(dirname "$omni_aef_target")"
  omni_assert_root_controlled_existing "$omni_aef_target"
  [ "$(omni_mode_of "$omni_aef_target")" = "$omni_aef_expected_mode" ] \
    || die "unexpected mode on $omni_aef_target"
}

omni_assert_exact_directory() {
  omni_aed_target=$1
  omni_aed_expected_mode=$2
  [ -d "$omni_aed_target" ] || die "required directory is missing: $omni_aed_target"
  omni_assert_root_controlled_ancestors "$omni_aed_target"
  omni_assert_root_controlled_existing "$omni_aed_target"
  [ "$(omni_mode_of "$omni_aed_target")" = "$omni_aed_expected_mode" ] \
    || die "unexpected mode on $omni_aed_target"
}

omni_ensure_directory() {
  omni_ed_target=$1
  omni_ed_expected_mode=$2
  omni_assert_no_symlink_components "$omni_ed_target"
  omni_assert_root_controlled_ancestors "$omni_ed_target"
  if [ -e "$omni_ed_target" ]; then
    omni_assert_exact_directory "$omni_ed_target" "$omni_ed_expected_mode"
    return 0
  fi
  install -d -o root -g root -m "$omni_ed_expected_mode" "$omni_ed_target"
  omni_assert_root_controlled_ancestors "$omni_ed_target"
  omni_assert_exact_directory "$omni_ed_target" "$omni_ed_expected_mode"
}

omni_atomic_install() {
  omni_ai_source=$1
  omni_ai_target=$2
  omni_ai_expected_mode=$3
  [ -f "$omni_ai_source" ] || die "install source is not a regular file: $omni_ai_source"
  omni_assert_root_controlled_ancestors "$omni_ai_source"
  omni_assert_absolute "$omni_ai_target"
  omni_assert_no_symlink_components "$(dirname "$omni_ai_target")"
  omni_assert_root_controlled_ancestors "$(dirname "$omni_ai_target")"
  if [ -e "$omni_ai_target" ] || [ -L "$omni_ai_target" ]; then
    omni_assert_root_controlled_existing "$omni_ai_target"
    [ -f "$omni_ai_target" ] || die "managed file target is not regular: $omni_ai_target"
  fi
  omni_ai_temporary="${omni_ai_target}.omnilodge-bootstrap.$$"
  [ ! -e "$omni_ai_temporary" ] && [ ! -L "$omni_ai_temporary" ] \
    || die "temporary install path already exists: $omni_ai_temporary"
  install -o root -g root -m "$omni_ai_expected_mode" "$omni_ai_source" "$omni_ai_temporary"
  mv -f "$omni_ai_temporary" "$omni_ai_target"
  omni_assert_root_controlled_ancestors "$(dirname "$omni_ai_target")"
  omni_assert_exact_file "$omni_ai_target" "$omni_ai_expected_mode"
}

omni_install_if_missing() {
  omni_iim_source=$1
  omni_iim_target=$2
  omni_iim_expected_mode=$3
  if [ -e "$omni_iim_target" ] || [ -L "$omni_iim_target" ]; then
    omni_assert_exact_file "$omni_iim_target" "$omni_iim_expected_mode"
    return 0
  fi
  omni_atomic_install "$omni_iim_source" "$omni_iim_target" "$omni_iim_expected_mode"
}

omni_touch_if_missing() {
  omni_tim_target=$1
  omni_assert_absolute "$omni_tim_target"
  omni_assert_no_symlink_components "$(dirname "$omni_tim_target")"
  omni_assert_root_controlled_ancestors "$(dirname "$omni_tim_target")"
  if [ -e "$omni_tim_target" ] || [ -L "$omni_tim_target" ]; then
    omni_assert_exact_file "$omni_tim_target" '600'
    return 0
  fi
  omni_tim_temporary="${omni_tim_target}.omnilodge-bootstrap.$$"
  [ ! -e "$omni_tim_temporary" ] && [ ! -L "$omni_tim_temporary" ] \
    || die "temporary touch path already exists: $omni_tim_temporary"
  : >"$omni_tim_temporary"
  chown root:root "$omni_tim_temporary"
  chmod 0600 "$omni_tim_temporary"
  mv "$omni_tim_temporary" "$omni_tim_target"
  omni_assert_exact_file "$omni_tim_target" '600'
}

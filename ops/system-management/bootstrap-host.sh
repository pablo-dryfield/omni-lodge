#!/bin/bash
set -euo pipefail
apply=false
if [[ "${1:-}" == --apply ]]; then apply=true; shift; fi
database="${1:-}"
if [[ "$EUID" != 0 || ! "$database" =~ ^[a-zA-Z0-9_]{1,63}$ ]]; then echo 'Use root and the exact application database name.' >&2; exit 1; fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ ! "$script_dir" =~ ^/opt/omnilodge/releases/omnilodge-[a-z0-9-]+/be/dist/systemManagement$ ]]; then echo 'Use the trusted immutable release artifact.' >&2; exit 1; fi
mapfile -t actors < <(runuser -u postgres -- psql --no-psqlrc --tuples-only --no-align --dbname "$database" --command 'SELECT u.id FROM users u JOIN "userTypes" r ON r.id=u."userTypeId" WHERE u.status AND u.approved AND r.status AND r.slug IN ('"'admin','administrator'"') AND NOT EXISTS(SELECT 1 FROM user_type_product_types p WHERE p.user_type_id=r.id) ORDER BY u.id')
if [[ "$apply" != true ]]; then printf 'Plan: create isolated broker/gateway, %s administrator execution and SFTP identities, chroot mounts, resource slice and watchdog. No changes performed.\n' "${#actors[@]}"; exit 0; fi
getent group omnilodge-system >/dev/null || groupadd --system omnilodge-system
id omnilodge-system >/dev/null 2>&1 || useradd --system --gid omnilodge-system --home-dir /var/lib/omnilodge-system/broker --shell /usr/sbin/nologin omnilodge-system
id omnilodge-sys-gw >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /bin/sh omnilodge-sys-gw
install -d -m 0750 -o root -g omnilodge-system /etc/omnilodge-system
install -d -m 2750 -o root -g omnilodge-system /run/omnilodge-system
install -d -m 0755 -o root -g root /var/lib/omnilodge-system /var/lib/omnilodge-system/host
install -d -m 0700 -o root -g root /var/lib/omnilodge-system/host/{nonces,operations,locks}
install -d -m 0700 -o omnilodge-system -g omnilodge-system /var/lib/omnilodge-system/broker
install -d -m 0755 -o root -g root /etc/ssh/authorized_keys /usr/local/libexec/omnilodge /srv/omnilodge-sftp /srv/omnilodge-operations /srv/omnilodge-staging /srv/omnilodge-shell
if [[ -e /usr/local/libexec/omnilodge/system-adapter ]]; then
  cmp --silent "$script_dir/adapter" /usr/local/libexec/omnilodge/system-adapter || { echo 'Adapter upgrade needs a reviewed compatibility/drain procedure.' >&2; exit 1; }
else install -m 0755 -o root -g root "$script_dir/adapter" /usr/local/libexec/omnilodge/system-adapter; fi
cat > /usr/local/libexec/omnilodge/system-gateway <<'GATEWAY'
#!/bin/sh
set -eu
[ "$#" -eq 0 ] || exit 64
cd /
exec /usr/bin/env -i PATH=/usr/bin:/bin TERM=xterm-256color LANG=C.UTF-8 /usr/bin/systemd-run --quiet --scope --slice=omnilodge-console.slice --property=MemoryMax=134217728 --property=CPUQuota=25% --property=TasksMax=64 -- /usr/local/libexec/omnilodge/system-adapter
GATEWAY
chmod 0755 /usr/local/libexec/omnilodge/system-gateway
chown root:root /usr/local/libexec/omnilodge/system-gateway
for actor in "${actors[@]}"; do
  [[ "$actor" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid administrator ID' >&2; exit 1; }
  execution="omnilodge-op-$actor"; files="omnilodge-sftp-$actor"
  id "$execution" >/dev/null 2>&1 || useradd --system --home-dir "/srv/omnilodge-shell/u$actor" --shell /usr/sbin/nologin "$execution"
  id "$files" >/dev/null 2>&1 || useradd --system --home-dir /work --shell /usr/sbin/nologin "$files"
  usermod -a -G "$files" "$execution"
  install -d -m 0750 -o "$execution" -g "$execution" "/srv/omnilodge-shell/u$actor"
  install -d -m 0750 -o root -g "$files" "/srv/omnilodge-operations/u$actor"
  install -d -m 0700 -o "$files" -g "$files" "/srv/omnilodge-staging/u$actor"
  install -d -m 0755 -o root -g root "/srv/omnilodge-sftp/$files" "/srv/omnilodge-sftp/$files/work" "/srv/omnilodge-sftp/$files/.staging"
  for entry in "/srv/omnilodge-operations/u$actor /srv/omnilodge-sftp/$files/work" "/srv/omnilodge-staging/u$actor /srv/omnilodge-sftp/$files/.staging"; do
    read -r source destination <<< "$entry"
    mountpoint -q "$destination" || mount --bind "$source" "$destination"
    mount -o remount,bind,nosuid,nodev "$destination"
    line="$source $destination none bind,nosuid,nodev 0 0"
    grep -Fxq "$line" /etc/fstab || printf '%s\n' "$line" >> /etc/fstab
  done
  for restricted in "$files" omnilodge-sys-gw; do
    slice="user-$(id -u "$restricted").slice"
    install -d -m 0755 -o root -g root "/etc/systemd/system/$slice.d"
    printf '[Slice]\nMemoryMax=67108864\nCPUQuota=10%%\nTasksMax=32\n' > "/etc/systemd/system/$slice.d/50-omnilodge-system.conf"
    chmod 0644 "/etc/systemd/system/$slice.d/50-omnilodge-system.conf"
  done
  loginctl disable-linger "$execution" >/dev/null 2>&1 || true
  systemctl mask "user@$(id -u "$execution").service" >/dev/null
  for name in "$execution" "$files" omnilodge-sys-gw omnilodge-system; do
    for deny in /etc/cron.deny /etc/at.deny; do touch "$deny"; grep -Fxq "$name" "$deny" || printf '%s\n' "$name" >> "$deny"; done
  done
done
cat > /etc/ssh/sshd_config.d/91-omnilodge-system.conf <<'SSH'
DenyUsers omnilodge-op-*
Match User omnilodge-sys-gw
    AuthenticationMethods publickey
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    PermitUserRC no
    PermitTTY yes
    ForceCommand /usr/bin/sudo -n /usr/local/libexec/omnilodge/system-gateway
Match User omnilodge-sftp-*
    AuthenticationMethods publickey
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    ChrootDirectory /srv/omnilodge-sftp/%u
    ForceCommand internal-sftp -d /work -u 0077
    AllowTcpForwarding no
    AllowStreamLocalForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTunnel no
    PermitUserRC no
    PermitTTY no
Match all
SSH
chmod 0600 /etc/ssh/sshd_config.d/91-omnilodge-system.conf
printf '%s\n' 'omnilodge-sys-gw ALL=(root) NOPASSWD: /usr/local/libexec/omnilodge/system-gateway ""' > /etc/sudoers.d/omnilodge-system
chmod 0440 /etc/sudoers.d/omnilodge-system
visudo -cf /etc/sudoers.d/omnilodge-system
/usr/sbin/sshd -t
cat > /etc/systemd/system/omnilodge-console.slice <<'UNIT'
[Unit]
Description=Aggregate remote console workload
[Slice]
MemoryMax=268435456
CPUQuota=25%
TasksMax=64
UNIT
cat > /etc/systemd/system/omnilodge-system-watchdog.service <<'UNIT'
[Unit]
Description=Expire orphaned OmniLodge console execution leases
[Service]
Type=oneshot
ExecStart=/usr/local/libexec/omnilodge/system-adapter watchdog
User=root
Group=root
NoNewPrivileges=yes
PrivateTmp=yes
UNIT
cat > /etc/systemd/system/omnilodge-system-watchdog.timer <<'UNIT'
[Unit]
Description=Check OmniLodge console leases
[Timer]
OnBootSec=10s
OnUnitActiveSec=5s
AccuracySec=1s
[Install]
WantedBy=timers.target
UNIT
printf '%s\n' 'd /run/omnilodge-system 2750 root omnilodge-system -' > /etc/tmpfiles.d/omnilodge-system.conf
cat > /etc/systemd/system/omnilodge-system-cleanup.service <<'UNIT'
[Unit]
Description=Clean owned expired console artifacts and replay nonces
[Service]
Type=oneshot
ExecStart=/usr/local/libexec/omnilodge/system-adapter cleanup
User=root
Group=root
NoNewPrivileges=yes
PrivateTmp=yes
MemoryMax=67108864
CPUQuota=10%
TasksMax=16
UNIT
cat > /etc/systemd/system/omnilodge-system-cleanup.timer <<'UNIT'
[Unit]
Description=Bound console journal and trash retention
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
# Start the timer only after adapter.json has been provisioned.
systemctl reload ssh
echo 'Host boundaries provisioned. Provision the protected authority/configuration next; admission remains disabled.'

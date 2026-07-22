#!/usr/bin/env bash
# harden-baseline.sh — Ubuntu 24.04 baseline for a fresh VPS ({VPS_HOST})
#
# Run ON the VPS as the ubuntu user:  bash harden-baseline.sh
# Idempotent: safe to re-run.
#
# Cross-checked against OVH "How to secure a VPS" (docs.ovhcloud.com, guide
# updated 2026-01-21). Adopted: system updates, key-only-auth path, firewall,
# fail2ban. Skipped/deferred (see README): SSH port change (operator-optional),
# OVH Network Firewall + Snapshot/Automated Backup (panel-only actions),
# extra restricted user (`ubuntu` is already the non-root sudo user).
#
# This script does NOT disable SSH password auth or root login. That is done
# separately with the open-session protection ritual (see bottom section).

set -euo pipefail

log() { printf '\n==> %s\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

export DEBIAN_FRONTEND=noninteractive

# --- 1. System update -------------------------------------------------------
log "apt update + upgrade"
$SUDO apt-get update -y
$SUDO apt-get upgrade -y

# --- 2. Unattended security upgrades ----------------------------------------
log "unattended-upgrades"
$SUDO apt-get install -y unattended-upgrades
# Enable periodic runs (idempotent overwrite of the canonical auto file)
$SUDO tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
$SUDO systemctl enable --now unattended-upgrades.service

# --- 3. Firewall: ufw, SSH allowed BEFORE enabling --------------------------
log "ufw: allow OpenSSH, default deny incoming, enable"
$SUDO apt-get install -y ufw
$SUDO ufw allow OpenSSH
$SUDO ufw default deny incoming
$SUDO ufw default allow outgoing
# --force: non-interactive; safe because OpenSSH was allowed above
$SUDO ufw --force enable
$SUDO ufw status verbose

# --- 4. fail2ban with sshd jail ----------------------------------------------
log "fail2ban: sshd jail"
$SUDO apt-get install -y fail2ban
$SUDO tee /etc/fail2ban/jail.d/sshd.local >/dev/null <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
$SUDO systemctl enable --now fail2ban
$SUDO systemctl restart fail2ban
$SUDO fail2ban-client status sshd || true

# --- 5. Swap: 2G (box ships with none) ---------------------------------------
log "swap: 2G /swapfile"
if ! $SUDO swapon --show | grep -q '/swapfile'; then
  if [ ! -f /swapfile ]; then
    $SUDO fallocate -l 2G /swapfile
    $SUDO chmod 600 /swapfile
    $SUDO mkswap /swapfile
  fi
  $SUDO swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
$SUDO swapon --show

# --- 6. (Optional) Docker — uncomment to install -----------------------------
# log "docker (official repo)"
# $SUDO apt-get install -y ca-certificates curl
# $SUDO install -m 0755 -d /etc/apt/keyrings
# $SUDO curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
# $SUDO chmod a+r /etc/apt/keyrings/docker.asc
# echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
#   | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
# $SUDO apt-get update -y
# $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# $SUDO usermod -aG docker ubuntu   # re-login required to take effect

log "Baseline complete. SSH password auth and root login are UNCHANGED."

# =============================================================================
# !!! RUN ONLY AFTER KEY LOGIN CONFIRMED FROM A SECOND TERMINAL !!!
#
# Before uncommenting and running the lines below, open a SECOND terminal and
# verify:   ssh -o BatchMode=yes ubuntu@{VPS_HOST} 'echo KEYLESS-OK'
# Keep the first session open until the second confirms. Locking these down
# without a working key = locked out of the box (OVH console rescue only).
#
# NOTE: the drop-in MUST sort BEFORE 50-cloud-init.conf — sshd config is
# first-match-wins and Ubuntu cloud images ship
# /etc/ssh/sshd_config.d/50-cloud-init.conf with "PasswordAuthentication yes".
# A 90- prefix silently loses; use 00-.
#
# $SUDO tee /etc/ssh/sshd_config.d/00-hardening.conf >/dev/null <<'EOF'
# PasswordAuthentication no
# PermitRootLogin no
# EOF
# $SUDO sshd -t && $SUDO systemctl reload ssh
#
# See README.md for the full protection-ritual walkthrough (open master
# session + second-connection verify before closing the first).
# =============================================================================

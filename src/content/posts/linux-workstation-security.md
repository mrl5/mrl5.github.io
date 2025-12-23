---
author: 'Jakub Kołodziejczak'
title: 'Linux workstation setup -- security tuning'
pubDate: 2024-08-21
image: 'https://static0.howtogeekimages.com/wordpress/wp-content/uploads/wm/2025/06/linux-mascot-wearing-sunglasses-and-using-a-laptop-surrounded-by-floating-windows-with-the-i3-window-manager-logo-in-the-background.png?q=70&fit=crop&w=1568&h=1078&dpr=1'
description: '(Part 2) How to configure linux laptop so that it can serve as a workstation that meets sensible security baseline?'
tags: [
    'laptop',
    'linux',
    'security',
]
---

This article is the follow-up of previous `linux workstation setup -- basic
setup on lenovo laptop` blog post. I'll try to document (opinionated) steps
that should make your laptop more secure for this threat model scenarios:
* someone gaining physical access to the laptop
* software or firmware vulnerabilities
* software misconfigurations leading to increased attack surface or privilege
  escalation

**DISCLAIMER** this is just my private opinion and [Your Milage May
Vary](https://dictionary.cambridge.org/dictionary/english/ymmv). Feel free to
adjust it according to your needs and your threat model. You can find much more
detailed and comprehensive guide at
https://madaidans-insecurities.github.io/guides/linux-hardening.html

## Requirements

#### 1. Use GPT (GUID Partition Table) instead of MBR (Master Boot Record)
GPT should be used when booting using UEFI. MBR is considered legacy.

#### 2. All filesystems MUST be encrypted. The only exception can be `/boot`.
This should prevent loading malware but also protects at-rest data stored in
encrypted device.

#### 3. Encryption password MUST be asked on boot.

#### 4. Prevent unauthorized boot from LiveCD.
This should protect against tampering with filesystem via LiveCD. Most likely
malicious actor would need to tamper with laptop physically first.

#### 5. Security updates MUST be installed at least once per week.
This ensures that software is patched in a timely manner and attack surface is reduced.

#### 6. For daily work use low privilege account.

#### 7. All inbound connections must be dropped by default.
This reduces attack surface. Especially while you're connected to untrusted
network.

#### 8. OS must lock itself after 15 minutes of inactivity.
It makes sure that user session is locked after some unattended period. It
makes less likely that someone will impersonate, gaining access to the system.

#### 9. Hibernate instead of sleep.
Sleep suspends to RAM, which makes it possible to perform [Cold Boot
Attack](https://blog.f-secure.com/cold-boot-attacks/). Hibernation suspends to
SWAP which should be encrypted (as per requirement #2).

#### 10. Use password manager
With password manager you need to remember less passwords and you can have
strong and unique password per service.


## Implementation

### LiveCD

#### 1. Use GPT (GUID Partition Table) instead of MBR (Master Boot Record)
#### 2. All filesystems MUST be encrypted. The only exception can be `/boot`.
#### 3. Encryption password MUST be asked on boot.

Most likely your LiveCD installation covers every requirement already.

### BIOS

#### 4. Prevent unauthorized boot from LiveCD.

First inspect in CLI current boot order and adjust accordingly
```console
efibootmgr
```

We want our disk to have top prio. Then:
1. Go to "Security->Password", set "Supervisor Password" and "Password at Boot
   Device List"
2. Go to "Startup" and set "Boot Order Lock"

### Various GNU/Linux CLI settings

#### 5. Security updates MUST be installed at least once per week.

System packages:
```console
apt install unattended-upgrades
vim /etc/apt/apt.conf.d/20auto-upgrades
```
```diff
+ APT::Periodic::Update-Package-Lists "1";
+ APT::Periodic::Unattended-Upgrade "1";
```

Firmware
```console
apt install fwupd
fwupdmgr get-devices
fwupdmgr refresh
fwupdmgr get-updates
```
We want to check for updates periodically so make sure that this service is
enabled and running.
```console
systemctl status fwupd-refresh.timer
```
You should get information about available upgrades via `/etc/motd`

#### 6. For daily work use low privilege account.

* we want to use `sudo` instead of `su`, for rationale you can check
  https://www.zdnet.com/article/what-is-sudo-in-linux-and-why-is-it-so-important/

* we want to limit `su` only to `wheel` group, follow steps from
  https://wiki.debian.org/WHEEL/PAM and skip adding your user to that group

* YMMV, but it's better to require `sudo` for docker instead of adding user to
  the `docker` group, rationale can be found e.g. here
  https://www.reddit.com/r/docker/comments/syngw7/to_sudo_or_not_to_sudo_that_is_the_question/

* now with `sudo` there are two possible approaches:
  * either stick with default behavior of providing user password -- but then
    you need to lock root account
  * ... or require root password to authenticate `sudo` -- but then you must
    not lock root account.

If you want to provide user password on `sudo` make sure to lock root account:
```console
passwd -l root
```

Otherwise, if you prefer to authenticate `sudo` with root password you need to
skip the command above and instead, for CLI:
```console
visudo
```
```diff
- Defaults    env_reset
+ Defaults    env_reset, runaspw
```
We still need to remember about polkit, used esp. in GUI. You can refer to
https://askubuntu.com/questions/1199006/how-to-let-polkit-request-root-password-instead-users-password

If `/etc/polkit-1/localauthority.conf.d` is empty and you can't apply steps
from above link then create `/etc/polkit-1/rules.d/49-rootpw-global.rules`:
```diff
+ polkit.addAdminRule(function(action, subject) {
+     return ["unix-user:root"];
+ });
```

#### 7. All inbound connections must be dropped by default.

Let's check current rules first
```console
sudo iptables -L
```
Now let's use more friendly frontend
```console
sudo apt install ufw
sudo ufw enable
```
Let's see what was added
```console
sudo ufw status verbose
```
if we want to run locally some database or other server we need to
```console
sudo ufw allow from 127.0.0.1 to 127.0.0.1
```
Let's check ufw friendly output and new iptables output
```console
sudo ufw status verbose
sudo iptables -L
```

#### 8. OS must lock itself after 15 minutes of inactivity.

This setting is most likely controlled by your Desktop Environment.

#### 9. Hibernate instead of sleep.

Modify `/etc/systemd/logind.conf` so that on lid close it hibernates
```diff
- #HandleLidSwitch=suspend
+ HandleLidSwitch=hibernate
```

You can also configure suspend sedation, which means that you "unlock" step 3
in this flow:
1. Screen is locked after inactivity
2. System suspends to RAM after more inactivity
3. System hibernates after even more inactivity

For more details refer to https://wiki.debian.org/SystemdSuspendSedation

#### 10. Use password manager

For example https://keepassxc.org/

## Wrap up

Hope this helps. That's all for today.

---

Image taken from https://www.howtogeek.com/beginner-facts-about-linux/ -- Credit: Lucas Gouveia/How-To Geek

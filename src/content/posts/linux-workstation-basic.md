---
author: 'Jakub Kołodziejczak'
title: 'Linux workstation setup -- basic setup on lenovo laptop'
pubDate: 2024-08-16
image: 'https://static0.howtogeekimages.com/wordpress/wp-content/uploads/wm/2025/11/tux-the-linux-mascot-wearing-sunglasses-beside-a-screen-showcasing-different-linux-distros.png?w=1600&h=900&fit=crop'
description: '(Part 1) How to configure linux laptop so that it can serve as a workstation that meets sensible security baseline?'
tags: [
    'laptop',
    'linux',
    'lenovo',
]
---

This article describes the process for Lenovo ThinkPad X1 Carbon Gen 11 but I
think it should be similar to other Lenovo laptops as well. It should be
applicable to laptops from other vendors but
[YMMV](https://dictionary.cambridge.org/dictionary/english/ymmv).

## How to choose Linux compatible laptop

Some models are well supported by Linux, other require proprietary software and
there might be some models that will cause you some headaches. For checking
compatibility you might be interested in:
* https://ubuntu.com/certified/laptops
* https://www.linux-laptop.net/

Additionally, you might be interested in [Replace Your Exploit-Ridden Firmware
with Linux - Ronald Minnich,
Google](https://www.youtube.com/watch?v=iffTJ1vPCSo) talk. If you're concerned
then you might want to buy laptop with supported hardware from non-mainstream
vendors. Check:
* https://www.coreboot.org/users.html (section `How to get hardware with
  coreboot?`)
* https://www.linuxboot.org/

## Leverage pre-installed Windows

**DISCLAIMER** -- this section is strongly based on this references:
* https://news.ycombinator.com/item?id=35324961
* https://www.theregister.com/2023/03/10/thinkpad_x1c_g10_linux/
* https://www.theregister.com/2022/07/22/linux_nonapproved_laptop

### Windows Updates

Let's start with booting our pre-installed Windows and run `Windows Update`.
You must note that checking for updates once is not enough -- this will require
reboots and re-runs of `Windows Update` couple of times.

Now we can also add `Microsoft Store` to the mix and run updates there.

### BIOS and firmware updates

This is probably the most relevant part -- perhaps we could use
[fwupd](https://fwupd.org/) during LiveCD install, however there is a chance
that on windows whole process would be more user friendly and maybe even more
drivers/firmware will be updated.

Let's run Lenovo tool -- for my case it's called `Lenovo Commercial Vantage`.
Running update will most likely update BIOS and some other firmware. Per
analogy to Windows Updates, you should re-run this after reboot couple times.

### Windows recovery

Just in case we might want to [create windows recovery
drive](https://support.microsoft.com/en-us/windows/create-a-recovery-drive-abb4691b-5324-6d4a-8766-73fab304c246)

### Other preconditions

Let's ensure that:
1. Bitlocker or other windows encryption is disabled. Go to `BitLocker Drive
   Encryption`, if it's enabled then choose `Turn off BitLocker`. Now you need
   to wait until decryption finishes.
2. Secure Boot is disabled (it's broken anyway
   [ref](https://arstechnica.com/security/2024/07/secure-boot-is-completely-compromised-on-200-models-from-5-big-device-makers/)).
   You can find some instructions here
   https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/disabling-secure-boot?view=windows-11#disable-secure-boot

This steps are needed so that Linux can see and read disk(s).

## Linux LiveCD

### Download and verify

Download your favorite GNU/Linux distribution
* after download compare SHA256 checksums

### Create bootable USB

This tutorial documents multiple ways of doing it --
https://wiki.debian.org/DebianInstall#Creating_a_Bootable_Debian_USB_Flashdrive

If you want to do it in some Linux (or WSL), then - as per
https://www.debian.org/releases/stable/amd64/ch04s03.en.html - it's CLI
oneliner:
```console
# image must be written to the whole-disk device and not a partition, e.g.
# /dev/sdb and not /dev/sdb1

sudo cp -v your-livecd.iso /dev/sdX && sudo sync
```

### Run LiveCD

1. Plug it
2. Reboot laptop
3. Hit F12 to enter BIOS
4. Choose your bootable media

You can now proceed with the tutorial of your favorite GNU/Linux distro. If
there is any security guideline related to setting up Linux Worstation make
sure to follow it. Some possible example would be to use disk encryption or
setting basic firewall rules.

## Post install steps

Here are recommended steps that are not documented in this document.

1. Consider additional BIOS and boot hardening
2. Consider additional GNU/Linux hardening
3. Prefer hibernation over suspension

## Summary

We learned how to:
* update BIOS, firmware and drivers on fresh Lenovo laptop by leveraging
  pre-installed Windows features
* create Windows Recoverable Disk
* prepare Laptop for GNU/Linux installation
* create LiveCD used for installation
* consider additional security configurations

That's it folks, stay tuned for next part where additional security
configuration will be discussed.

---

Image taken from https://www.howtogeek.com/these-are-the-only-linux-distros-i-recommend-for-power-users/ -- Credit: Lucas Gouveia/How-To Geek

---
author: 'Jakub Kołodziejczak'
title: 'TLS certificates for internal services done SIMPLER'
pubDate: 2026-07-12
description: 'Follow-up for "done right" that could be titled "done GOOD ENOUGH"'
image: '/img/eastwood.png'
tags: [
    'dns',
    'tls',
    'acme',
    'letsencrypt',
]
---

My [previous post](/posts/tls-for-internal-services) about TLS for internal
services got [some interest on Hacker
News](https://news.ycombinator.com/item?id=48846995). It was really cool too
see valuable feedback and comments. I gained a new perspective on how to
improve as a blog author but also on how TLS for internal services can be done
simpler.

## Controversy around split-horizon DNS

Let's use the [five whys](https://en.wikipedia.org/wiki/Five_whys) technique to
reiterate on this topic.

1. *Why split-horizon DNS?*
   * Because I choose to use [HTTP-01
     challenge](https://letsencrypt.org/docs/challenge-types/#http-01-challenge)
     for ACME.
2. *Why HTTP-01 challenge?*
   * Because I prefer to avoid [DNS-01
     challenge](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge).
   * Because of habit from obtaining certs for public services.
3. *Why avoid DNS-01 challenge?*
   * Because of my resistance against delegating DNS records to automation.
4. *Why resistance against DNS automation?*
   * Because my DNS provider (Porkbun) doesn't allow restricting API key only
     to TXT records. They allow scoping only to APEX domain and to specific
     IPs.
5. *Why not other challenge types?*
   * Because
     [DNS-PERSIST-01](https://letsencrypt.org/2026/02/18/dns-persist-01) is
     still [not supported by Let's
     Encrypt](https://github.com/acmesh-official/acme.sh/issues/7085#issuecomment-4929516193).
   * Because [TLS-ALPN-01](https://letsencrypt.org/docs/challenge-types/#tls-alpn-01)
     requires port `443` which is already in use by reverse proxy.

### New perspectives

Now - once my reasoning is clearer - we can think how to simplify the setup.
First, let's give DNS-01 another chance. How can we make it approachable for
slightly more paranoid individuals (like myself)? Turns out that there is a
[DNS alias
mode](https://github.com/acmesh-official/acme.sh/wiki/DNS-alias-mode) (KUDOS to
[sigio for pointing that out](https://news.ycombinator.com/item?id=48852829)).
The only drawback is that we'd need additional APEX domain that we feel
comfortable to use with API key.

Ok, we switch to DNS-01 challenge (one way or another) -- how it makes the
whole setup simpler? We can now ditch the infamous split-horizon DNS and unify
public DNS record so that `grafana.tuxnet.dev` resolves to internal IP
`10.0.1.10` -- for everyone.

### Unknowns

I'm still not sure if it's an issue to "leak" a specific internal IP address
into public DNS record or not. Worth noting that there was some [discussion
started by Walf](https://news.ycombinator.com/item?id=48854783) in this regard.

If it's an issue, then I guess the only alternative left is to remove the
public part from split horizon approach and have an "A" record only in our
internal DNS server.

## Controversy around Certificate Transparency (CT) logs

This is a missing part from `Bonus — SANs and CNAMEs` section where I mentioned
wildcard certificate and Subject Alternative Name certificate. **CT logs is
quite significant detail that requires some attention**.

When a Certificate Authority issues a certificate it is saved in public,
transparent logs. On one hand it offers improvements to the CA ecosystem and
web security, but on the other hand it is used in OSINT for subdomain
enumeration. 

This might be considered a privacy issue and might outweigh [security
concerns](https://knowledge.digicert.com/quovadis/ssl-certificates/ssl-general-topics/what-are-the-pros-and-cons-of-a-wildcard-certificate)
mentioned in original post. For example, enumerated subdomains could unblock
next moves for malicious actors.

### New perspectives

In scope of my homelab, privacy of subdomains is not a concern - but - YMMV.
Either way, user [nijave wrote a
comment](https://news.ycombinator.com/item?id=48849029) that resonates with me:
> Removing attack surface is better than trying to hide it.

If wildcard certificate reduces attack surface for your use case, then use it.
Now we should have a better picture about trade-offs for both solutions and our
toolbox is more complete.

## Thank you!


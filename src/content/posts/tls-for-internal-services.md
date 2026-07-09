---
author: 'Jakub Kołodziejczak'
title: 'TLS certificates for internal services done right'
pubDate: 2026-07-09
description: "No self-signing headaches, no TLS erros."
image: '/img/this-is-the-way.webp'
tags: [
    'dns',
    'tls',
    'acme',
    'letsencrypt',
    'netbird',
    'nginx',
    'acme.sh'
]
---

Title is a bit clickbait-y -- YMMV, but let me explain why I think "this is the
way". Let's start with a simple example -- we have a server which hosts bunch
of HTTP services. Some of those services are external, others internal. In
order to reach the internal ones you need to be connected to the VPN.

For the sake of simplicity let's consider we have two choices:
1. We use top-level domain [restricted by ICANN for private
   use](https://itp.cdn.icann.org/en/files/root-system/identification-tld-private-use-24-01-2024-en.pdf)
   -- e.g. `.internal`.
2. We use a public apex domain that we own -- e.g. `tuxnet.dev`

Grafana would be our example internal app. Let's assume that it's reachable on
`10.0.1.10` internal IP address and our VPN has DNS resolver features.

## What's wrong with `.internal` then?

We could simply create a DNS record of type "A" that resolves to `10.0.1.10`
internal IP address -- e.g. `grafana.tuxnet.internal`. But then if we don't
want it to be a plain text HTTP service we would need to create a self-signed
certificate.

The good part is that there are plenty tutorials that show you how to do this
(e.g. [this
one](https://www.digitalocean.com/community/tutorials/how-to-create-a-self-signed-ssl-certificate-for-nginx-in-ubuntu-16-04)).
The ugly part is that suddenly every HTTP client should be configured to trust
this self-signed certificate. Alternatively we could just tell our users to
ignore the TLS certificate errors `¯\_(ツ)_/¯`.

## How to do it "the right way"

Meet the "split-horizon DNS" configuration. For public DNS resolvers our
`grafana.tuxnet.dev` domain resolves to a public IP and for clients connected
to the VPN this domain resolves to an internal IP.

The good part is that since it resolves to a public IP we can use some public
CA like Let's Encrypt or ZeroSSL. The ugly part is that we still need some WAF
rejecting traffic that does not originate from the VPN.

Considering pros and cons of both solutions I think it's much easier to set up
a WAF in one place (on our server) than to install self-signed certificate on
every machine that joins our internal network (... or advising our users to
suppress the TLS errors).

## "Talk is cheap show me the code"

We have theory now, time to get our hands dirty. We will need:
1. A VPN with DNS resolver features -- I choose [NetBird](https://netbird.io/).
2. ACME client for issuing a certificate -- I choose [acme.sh](https://github.com/acmesh-official/acme.sh).
3. A reverse proxy with WAF features in front of our grafana -- I choose [nginx](https://nginx.org/).

If you've read my other blog posts you probably noticed that I am a fan of
NetBird (sorry Tailscale). Thanks to [Custom
Zones](https://docs.netbird.io/manage/dns/custom-zones) feature, NetBird does
all the heavy lifting required for "split-horizon DNS" for us. By using [user
groups](https://docs.netbird.io/manage/access-control#user-groups) or [peer
groups](https://docs.netbird.io/manage/access-control#peer-groups) we can
selectively apply Custom Zones so that server uses public DNS resolver for
`grafana.tuxnet.dev`.

Why exclude server from that custom zone? It's not required unless we want to
use [http-01 challange](https://letsencrypt.org/docs/challenge-types/). Using
other methods is also possible but for the sake of this blog post I choose
`http-01`. Ok, let's get the certificate now with:
```console
acme.sh --issue -d grafana.tuxnet.dev --server letsencrypt --standalone
```
`acme.sh` is quite flexible and has [a lot of
modes](https://github.com/acmesh-official/acme.sh#%EF%B8%8F-supported-modes).
The cool part about the standalone mode (enabled with `--standalone` flag) is
that our nginx doesn't have to listen on port 80 at all. This port becomes
"active" only when `acme.sh` gets the certificate.

Ok now we can put nginx into action. This is our config:
```
upstream grafana {
    server localhost:3000;
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen our-server.netbird.cloud:443 ssl;
    server_name grafana.tuxnet.dev;
    http2 on;

    ssl_certificate     /etc/ssl/certs/grafana.tuxnet.dev.crt;
    ssl_certificate_key /etc/ssl/private/grafana.tuxnet.dev.key;

    access_log /var/log/nginx/grafana.tuxnet.dev.access.log main;
    error_log  /var/log/nginx/grafana.tuxnet.dev.error.log warn;

    location / {
        proxy_pass http://grafana;
        proxy_set_header Host $host;
    }
  
    # Proxy Grafana Live WebSocket connections.
    location /api/live/ {
        proxy_pass http://grafana;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host       $host;
    }
}
```
There is one key setting in this configuration worth explaining -- `listen
our-server.netbird.cloud:443 ssl;`. We are binding to the VPN network interface
of our server. Instead of `our-server.netbird.cloud` this could be a VPN IP
address. In practice this will reject any traffic to `grafana.tuxnet.dev` that
originates from public internet -- this is our Web Access Firewall.

Security is about layers (just like onions and ogres). Our first layer is
split-horizon DNS but if for whatever reason it fails or is cleverly bypassed
we have a 2nd layer - WAF - that should hold the line.

Last but not least -- certificate auto renewal. `acme.sh` has a out-of-the box
`--cron` flag. Now we need a daily cron job that will call
```
acme.sh --cron
```
`acme.sh` automatically chooses which certificates should be renewed. All we
need to do is to make sure that cron job copies new certificates into the
location defined in nginx's `ssl_certificate` and `ssl_certificate_key`. Nginx
also needs to be reloaded to use new certificates. Our cron job could look like
this:
```bash
main() {
    refresh_certs
    sync_api_tuxnet_dev_certs
    sync_internal_tuxnet_dev_certs
    reload_nginx
}

refresh_certs() {
    setcap CAP_NET_BIND_SERVICE=+ep /usr/bin/socat1
    sudo -u acmesh /home/acmesh/acme.sh/acme.sh --cron
    setcap -r /usr/bin/socat1
}

sync_api_tuxnet_dev_certs() {
    local green=$(get_checksum "$API_SRC_KEY")
    local blue=$(get_checksum "$API_DST_KEY")
    local key_allowed_group=www-data

    if [[ "$green" != "$blue" ]]; then
        sync_certs "$API_SRC_KEY" "$API_DST_KEY" "$API_SRC_CERT" "$API_DST_CERT" "$key_allowed_group"
    fi
}

sync_internal_tuxnet_dev_certs() {
    local green=$(get_checksum "$INTERNAL_SRC_KEY")
    local blue=$(get_checksum "$INTERNAL_DST_KEY")
    local key_allowed_group=www-data

    if [[ "$green" != "$blue" ]]; then
        sync_certs "$INTERNAL_SRC_KEY" "$INTERNAL_DST_KEY" "$INTERNAL_SRC_CERT" "$INTERNAL_DST_CERT" "$key_allowed_group"
    fi
}

reload_nginx() {
    nginx -t
    systemctl reload nginx
}

get_checksum() {
    sha256sum "$1" | cut -d' ' -f1
}

sync_certs() {
    local src_key="$1"
    local dst_key="$2"
    local src_cert="$3"
    local dst_cert="$4"
    local key_allowed_group="$5"

    cp -v "$src_key" "$dst_key"
    logger "synced $dst_key"

    cp -v "$src_cert" "$dst_cert"
    logger "synced $dst_cert"

    chown root:${key_allowed_group} "$dst_key"
    chown root:ssl-cert "$dst_cert"
    chmod 640 "$dst_key" "$dst_cert"

}

main "$@"

```
Small comment about `setcap CAP_NET_BIND_SERVICE=+ep /usr/bin/socat1`.
`acme.sh` in standalone mode uses `socat` in order to listen on port
80. On one hand we don't want to run `acme.sh` as root if we don't have to. On
the other hand port 80 is one of the "privileged ports" and by default,
privileged ports can't be bound to non-root processes. This is where
`CAP_NET_BIND_SERVICE=+ep` helps. You can check [this
article](https://www.baeldung.com/linux/bind-process-privileged-port) if you're
interested more in this topic.

![that feeling when TLS just works](/img/when-tls-just-works.png)

Life's good, we have a TLS that just works -- no matter if the service is
internal or external, no matter if it's "next day" or "next year".

## Bonus -- SANs and CNAMEs

What if we have more internal services? What if we want them under separate
subdomains? Do we need to generate separate certificates for each? The answer
is "no" and we have two solutions for that:
1. Wildcard certificates -- I'm not a fan of it because of [security
   implications](https://knowledge.digicert.com/quovadis/ssl-certificates/ssl-general-topics/what-are-the-pros-and-cons-of-a-wildcard-certificate).
2. TLS SAN (Subject Alternative Name) -- where apart of CN (Common Name) we define
   mentioned SANs. For more info check https://www.ssl.com/faqs/common-name/

So in practice we can create "A" record for `internal.tuxnet.dev` and then
"CNAME" records for `grafana.tuxnet.dev` and e.g. `analytics.tuxnet.dev` that
resolve to `internal.tuxnet.dev`. Then we generate one certificate like this:
```console
acme.sh --issue -d internal.tuxnet.dev -d grafana.tuxnet.dev -d analytics.tuxnet.dev --server letsencrypt --standalone
```

where its details look like this:
```console
echo | openssl s_client -connect internal.tuxnet.dev:443 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName
```
```
subject=CN=internal.tuxnet.dev
X509v3 Subject Alternative Name: 
    DNS:analytics.tuxnet.dev, DNS:grafana.tuxnet.dev, DNS:internal.tuxnet.dev
```

All we need to do now is to re-use the same certificate for different `server`
definitions in our nginx configs.

## Summary

We've learned how to securely set up TLS certificates for internal services
without creating TLS issues for http clients downstream. All thanks to
split-horizon DNS, WAF and ACME protocol. All for free!

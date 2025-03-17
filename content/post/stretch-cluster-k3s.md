+++
author = "Jakub Kołodziejczak"
title = "Stretch Kubernetes cluster with K3S and Netbird"
date = "2025-03-16"
tags = [
    "kubernetes",
    "wireguard",
    "netbird",
    "netmaker",
    "tailscale",
    "k3s",
    "raspberry",
    "pi",
    "rpi",
]
+++

So I want to have my self-hosted Kubernetes cluster. I want to have more than
one node with as little budget as possible. I want to have nodes in different
geographical locations. I don't want to expose my nodes to the Big Scary
Internet if possible.

This requirements sound reasonable (esp. when you have some spare Raspberry Pis
that can be put in different apartments). Described cluster architecture is
known as [stretched Kubernetes
cluster](https://www.cncf.io/blog/2021/09/16/redundancy-across-data-centers-with-kubernetes-wireguard-and-rook/)
Let's build it!

## Decision process

### Network

Our nodes that are spread in different locations need to talk to each other. We
have couple of options to achieve that:
1. [Wireguard](https://www.wireguard.com/) seems to be a natural choice, there
   are only two caveats though:
   * each node will need to have a public IP
   * they would have to expose at least one UDP port
   * adding new nodes comes with some overhead, because public keys would need
     to be shared between all nodes
2. [NetBird](https://netbird.io/) is an open source overlay network that's
   using WireGuard under the hood. It has many nice feature but the one that we
   care the most now is ability to automatically create point-to-point
   WireGuard tunnels between the nodes
3. [Tailscale](https://tailscale.com/) probably the most popular WireGuard VPN
   nowadays. Some of its components are open source.

Let's go with NetBird. Tailscale has pretty good support and various usecases
are well documented. Not a case with NetBrid that I happen to use.

### Kubernetes distro

We want to have something lightweight and because of limited budget we want
to self-host all components. On top of that it must support ARM
architecture -- we have some spare Raspberry Pi's, remember?

1. [K3S](https://k3s.io/)
2. [K0S](https://k0sproject.io/)

Let's go with K3S -- it seems to be more popular nowadays.

### Entrypoint

Because we don't want to expose too much to the internet let's have public
facing server hosted on some cloud provider. There are a couple of budget
options, let's name at least 3:
1. [Hetzner](https://www.hetzner.com/)
2. [OVH](https://www.ovhcloud.com/)
3. [Scaleway](https://www.scaleway.com)

Let's go with Hetzner -- for ARM with 2 vCPUs, 4GB of RAM and IPv4 (currenlty)
it costs [$4.59 monthly for European location](https://www.hetzner.com/cloud/).
Not bad! We also get 40 GB of NVME SSD and [20 TB for outgoing
traffic](https://docs.hetzner.com/robot/general/traffic/)

## Implementation

OK -- for the simplicity let's cover a scenario where we have one VPS on
Hetzner and one Raspberry Pi. We can ssh to both of them and run commands as
root. Both of our machines have Debian or Debian-derived distro (e.g. Ubuntu).
On top of that we have an account on https://app.netbird.io/

Please make sure that your Hetzner machine is behind firewall and only
necessary ports are open. Exposing Kubernetes control plane to the Big Scary
Internet is a no-no.

### Setup NetBird
Let's generate NetBird setup keys -- we will need them to join our VPN mesh.
For more info check https://docs.netbird.io/how-to/register-machines-using-setup-keys

Ok, let's [install and setup NetBird](https://docs.netbird.io/how-to/installation):
```console
sudo apt-get update
sudo apt-get install ca-certificates curl gnupg -y
curl -sSL https://pkgs.netbird.io/debian/public.key | sudo gpg --dearmor --output /usr/share/keyrings/netbird-archive-keyring.gpg
echo 'deb [signed-by=/usr/share/keyrings/netbird-archive-keyring.gpg] https://pkgs.netbird.io/debian stable main' | sudo tee /etc/apt/sources.list.d/netbird.list

sudo apt-get update
sudo apt-get install netbird
netbird up --setup-key <SETUP KEY>
```

### Setup K3S

Time for our Kubernetes cluster. [There is a dedicated
doc](https://docs.k3s.io/networking/distributed-multicloud) for that but I had
some hard times setting up a working cluster with it. Luckily [this
blogpost](https://itnext.io/how-to-deploy-a-single-kubernetes-cluster-across-multiple-clouds-using-k3s-and-wireguard-a5ae176a6e81)
by [Alex Feiszli](https://afeiszli.medium.com/) turned out to be working also
with NetBird after some slight modifications.

Let's install K3S server on our Hetzner cluster first
```console
NETBIRD_IFACE=wt0
NETBIRD_SERVER_IP=100.123.177.254
NETBIRD_CIDR=100.123.0.0/16
DEFAULT_NO_PROXY='127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'

curl -sfL https://get.k3s.io |
    NO_PROXY="127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,${NETBIRD_CIDR}" \
    INSTALL_K3S_EXEC="server --node-ip ${NETBIRD_SERVER_IP} --node-external-ip ${NETBIRD_SERVER_IP} --flannel-iface ${NETBIRD_IFACE} --disable=traefik" \
    sh -
```
where:
* `NETBIRD_IFACE` is taken from `ip a`
* `NETBIRD_SERVER_IP` is a VPN IP address of our hetzner server
* `NETBIRD_CIDR` is a "catch all" for every possible VPN IP
* `DEFAULT_NO_PROXY` is a value from
  https://docs.k3s.io/advanced#configuring-an-http-proxy -- it turns out that
  `NO_PROXY` [needs to be
  modified](https://devops.stackexchange.com/questions/19394/how-to-setup-a-k3s-cluster-on-netbird-or-tailscale) -- otherwise pods wont be able to reach other pods in different node

Let's check the result of `sudo kubectl get nodes` - status should be "Ready"
```
NAME                     STATUS     ROLES                  AGE    VERSION
htz-euc-fsn1-bastion-1   Ready      control-plane,master   122m   v1.31.6+k3s1
```
We can also check if all pods are running with `sudo kubectl get pods --all-namespaces`

Let's now get a Node Token that will be needed to add more nodes into our
cluster:
```
sudo cat /var/lib/rancher/k3s/server/node-token
```

Ok, let's join our Raspberry Pi to the cluster. We're gonna need to setup K3S
agent
```
SERVER_NODE_TOKEN=...
NETBIRD_IFACE=wt0
NETBIRD_CIDR=100.123.0.0/16
DEFAULT_NO_PROXY='127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'
NETBIRD_SERVER_IP=100.123.177.254
NETBIRD_AGENT_IP=100.123.205.52

curl -sfL https://get.k3s.io |
    NO_PROXY="${DEFAULT_NO_PROXY},${NETBIRD_CIDR}" \
    INSTALL_K3S_EXEC="agent --server https://${NETBIRD_SERVER_IP}:6443 --token ${SERVER_NODE_TOKEN} --node-ip ${NETBIRD_AGENT_IP} --node-external-ip ${NETBIRD_AGENT_IP} --flannel-iface ${NETBIRD_IFACE}" \
    sh -
```
where:
* `SERVER_NODE_TOKEN` is the value from
  `/var/lib/rancher/k3s/server/node-token` that we checked in Hetzner machine
* `NETBIRD_AGENT_IP` is a VPN IP address of our Raspberry Pi

Let's get back to our Hetzner machine and run `sudo kubectl get nodes`. We
should see two nodes now:
```
NAME                     STATUS     ROLES                  AGE    VERSION
htz-euc-fsn1-bastion-1   Ready      control-plane,master   132m   v1.31.6+k3s1
local-rpi                Ready      <none>                 129m   v1.31.6+k3s1
```

## Test

Now we need to make sure if there are no networking issues between the nodes. I
will reuse the steps from previousely mentioned [Alex's
blogpost](https://itnext.io/how-to-deploy-a-single-kubernetes-cluster-across-multiple-clouds-using-k3s-and-wireguard-a5ae176a6e81)
but another valuable test is to use
[Echo-Server](https://ealenn.github.io/Echo-Server/pages/quick-start/kubernetes.html)

So in our Hetzner machine lets run:
```
echo '
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pingtest
  namespace: pingtest
spec:
  selector:
    matchLabels:
      app: pingtest
  replicas: 2
  template:
    metadata:
      labels:
        app: pingtest
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - pingtest
            topologyKey: "kubernetes.io/hostname"
      containers:
      - name: busybox
        image: busybox
        command: ["/bin/sh", "-ec", "sleep 1000"]
' > pingtest.yaml

sudo kubectl create namespace pingtest
sudo kubectl apply -f pingtest.yaml
```

Once we see that pods are deployed with `sudo kubectl get pods -n pingtest -o wide`
```
NAME                       READY   STATUS    RESTARTS  AGE   IP          NODE                     NOMINATED NODE   READINESS GATES
pingtest-c867f8fcd-prm87   1/1     Running   0         15s   10.42.1.2   local-rpi                <none>           <none>
pingtest-c867f8fcd-vlnh2   1/1     Running   0         15s   10.42.0.5   htz-euc-fsn1-bastion-1   <none>           <none>
```

we can ensure there are no connectivity issues
```
sudo kubectl exec -ti pingtest-c867f8fcd-prm87 -n pingtest -- ping -c 3 10.42.1.2
sudo kubectl exec -ti pingtest-c867f8fcd-prm87 -n pingtest -- ping -c 3 10.42.0.5

sudo kubectl exec -ti pingtest-c867f8fcd-vlnh2 -n pingtest -- ping -c 3 10.42.1.2
sudo kubectl exec -ti pingtest-c867f8fcd-vlnh2 -n pingtest -- ping -c 3 10.42.0.5
```

## Next steps

You can now host some services on your own Kubernetes cluster. If you're
interested in simple setup I really recommend
https://paulbutler.org/2024/the-haters-guide-to-kubernetes/ -- there is no need
to overcomplicate things, but - as usual - YMMV.

I think running Caddy outside of the cluster (for certificate automation and
ingress) works perfectly.

If you feel adventurous you can make your K3S cluster HA:
* https://docs.k3s.io/datastore/ha
* https://docs.k3s.io/datastore/ha-embedded

## Summary

We've created our own, self-hosted Kubernetes cluster. We've spread the nodes
between cloud and on-prem locations. We've leveraged WireGuard based VPN for
connectivity and increased security.

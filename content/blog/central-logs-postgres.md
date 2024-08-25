+++
author = "Jakub Kołodziejczak"
title = "system logs aggregation with postgres"
date = "2024-07-14"
aliases = ["20240712_central-logs-postgres"]
tags = [
    "logs",
    "syslog",
    "postgres",
    "postgresql",
    "rsyslog",
    "observability",
    "ssh",
    "audit",
    "openwrt",
    "router",
    "raspberry",
    "pi",
    "rpi",
]
+++

![just posgres](https://www.amazingcto.com/images/JustPostgres.png.webp)


Imagine we have a home network with OpenWRT router, Raspberry Pi server and
some IoT devices. Rasberry Pi is our WireGuard VPN service that allows to
access our home network resources securely from the internet. It's probably
good idea to sometimes check the logs on each of those resources.

Let's admit it - security breaches happen. There can be many reasons for that,
like misconfigurations or software vulnerabilities. Unauthorized access can end
up with ransomware, cryptojacking, website defacement, etc. It's also not
uncommon that attackers want to cover up their activity (e.g. by log tampering)
and keep their persistence undetected. There are some techniques which prevent
logs manipulation and - as a consequence - allow investigation of such
cyberattacks, even when compromised system was totally pwned and it's no longer
accessible by the owner.

As an admin I want to have a central place which aggregates logs from multiple
systems. Logs must be aggregated in non-repudiate way. Logs aggregation server
should be independent from monitored systems.

## Options, alternatives

Observability and logs aggregation is a big topic. There are a lot of dedicated
solutions out there that you can buy and/or self-host. Let me name a few - just
for the record - [Dynatrace](https://www.dynatrace.com/),
[Splunk](https://www.splunk.com/), [New Relic](https://newrelic.com/), [ELK
stack](https://www.elastic.co/elastic-stack), [Graylog](https://graylog.org/),
[Vector](https://vector.dev/) or [Logflare](https://logflare.app/). Other
popular setup is [rsyslog used as linux log aggregation
server](https://www.redhat.com/sysadmin/log-aggregation-rsyslog).

The list of options available in the market can go on and on, but let's stop
for a moment, take a deep breath and embrace [the idea of using postgres for
everything](https://www.amazingcto.com/postgres-for-everything/) from Stephan
Schmidt. Even if we decide not to use PostgreSQL for storage but some [AWS
S3](https://aws.amazon.com/s3/) compatible service like
[wasabi](https://wasabi.com/), [backblaze](https://www.backblaze.com/) or
[CloudFlare R2](https://www.cloudflare.com/developer-platform/r2/) - querying
such storage with postgres is still possible! For example with [Parquet S3
FDW](https://www.postgresql.org/about/news/parquet-s3-fdw-100-released-2571/).

## Append-only log with PostgreSQL

We're gonna create a "good enough" solution for the scenario described above,
with PostgreSQL used for both storage and search capability. We will use:
* PosgreSQL, that's **hosted outside of monitored infrastructure**. "Outside"
  part is the important one, esp. for a case when our whole home network is
  breached but we still need to gather some evidence
* [rsyslog](https://www.rsyslog.com/) system logger, installed on every
  monitored resource (yeah, I assumed that everything runs on Linux `¯\_(ツ)_/¯`)

With postgres there are many low budget and even no budget options out there!
For free ones, I'd limit my choice to [Supabase](https://supabase.com/),
[Tembo](https://tembo.io/) or [Neon](https://neon.tech/).

With Neon you wont be able to use `pg_cron` extension ([as per their
documentation](https://neon.tech/docs/extensions/pg-extensions#extension-support-notes)).
`pg_cron` comes handy with log retention but you don't need it if you're ok
with doing this chore manually (more about log retention a bit later).

Tembo seams to be a great fit (not only because they have a dedicated
[timeseries stack](https://tembo.io/docs/product/stacks/analytical/timeseries)
but I feel that they have this open source spirit) however, their free "Hobby
Tier" option (at least at a time when I write this article) runs on [spot
instance](https://tembo.io/docs/product/cloud/configuration-and-management/spot-instances)
which basically means that from time-to-time database can be offline for ~10
minutes (not a good idea if we want to have a reliable solution for our use
case).

So - from the free options - as long as you care about full feature set and
decent availability, only Supabase is left on the table. Additional benefit is
that currently Supabase has probably the most rich backend-as-a-service
offering that's not only limited to postgres.

## PostgreSQL implementation

Finally - meat of this blogpost - I assume that you've already connected - as
an administrator - to your database server. If so, create a `logs` database and
switch to it:
```sql
CREATE DATABASE logs;
\c logs
```

### Create schemas

There are many strategies for
[multi-tenancy](https://www.crunchydata.com/blog/designing-your-postgres-database-for-multi-tenancy)
approach. In our case we should choose between "schema per device" (a.k.a
[Bridge
Model](https://d0.awsstatic.com/whitepapers/Multi_Tenant_SaaS_Storage_Strategies.pdf))
and "tenant discriminator in shared tables" (a.k.a [Pool
Model](https://d0.awsstatic.com/whitepapers/Multi_Tenant_SaaS_Storage_Strategies.pdf),
a.k.a shard key)

At this point we need to be aware about the trade-offs:
1. With "schema per device" we have a nice separation but for a case when we
   introduce new device we will be violating [DRY
   principle](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself). It will
   be violated by creating the same table one more time, in one more schema.
   Additionally we need to remember to include the new table in admin
   dashboard. In theory the latter part could be avoided by using
   [inheritance](https://www.postgresql.org/docs/current/tutorial-inheritance.html)
   however, later we will partition our table, which makes inheritance not
   possible.
2. With "tenant discriminator in shared tables" we can set up our admin
  dashboard and logs table once and then forget about it. On the other hand
  we will need additional index to be able to filter between devices.

For the sake of simplicity lets go with option #2.

```sql
CREATE SCHEMA logs;
```

### Create service users

```sql
CREATE ROLE home_rpi WITH NOINHERIT LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER
    PASSWORD 'SUPER_SECRET_PASSWORD_1';
```
```sql
CREATE ROLE home_openwrt WITH NOINHERIT LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER
    PASSWORD 'SUPER_SECRET_PASSWORD_2';
```
```sql
-- this role will be used for reading logs from dashboard view
CREATE ROLE logs WITH NOINHERIT LOGIN NOCREATEDB NOCREATEROLE NOSUPERUSER
    PASSWORD 'SUPER_SECRET_PASSWORD_3';
```
You might want to set some other password than `SUPER_SECRET_PASSWORD_1`.

### One table for system logs

```sql
CREATE TABLE logs.syslog (
    id bigint GENERATED ALWAYS AS IDENTITY,
    received_at timestamptz NOT NULL,
    device_reported_time timestamptz NOT NULL,
    info_unit_id int,
    facility smallint,
    priority smallint,
    from_host text,
    syslog_tag text,
    pgsql_user text DEFAULT CURRENT_USER,
    message text,

    PRIMARY KEY (id, device_reported_time)
);
CREATE INDEX ON logs.syslog USING BTREE (pgsql_user);
CREATE INDEX ON logs.syslog USING BTREE (device_reported_time DESC);
```

"Why composite primary key", you might ask. The reason is table partitioning
that will be applied in next step. If pkey would be set on id column, we would
get this error:
```
ERROR:  unique constraint on partitioned table must include all partitioning columns
DETAIL:  PRIMARY KEY constraint on table "syslog" lacks column "device_reported_time" which is part of the partition key.
```

It's also worth mentioning that the column order is not random here. There are
some tricks mentioned by David Christensen in [his PGConf NYC 2022
speech](https://youtu.be/9_pbEVeMEB4?t=1082) that reduce size of the table.

Last but not least indexes. It's probably good idea to have an ability for
performant filtering by the log source, hence index on `pgsql_user`. It would
be also nice to have a fast timerange filter (e.g. logs from last 24 hours) -
notice that additionally I've added `DESC` keyword. It will speed up queries
that show most recent entry as the first one (we will need it in dashboard
view a bit later).

Aaaaand one more security layer that will guarantee
[non-repudiation](https://csrc.nist.gov/glossary/term/non_repudiation):
```sql
CREATE FUNCTION logs.t_override_pgsql_user ()
    RETURNS TRIGGER
    AS $$
BEGIN
    IF NEW.pgsql_user IS NOT NULL THEN
        NEW.pgsql_user := CURRENT_USER;
    END IF;
    RETURN new;
END;
$$
LANGUAGE plpgsql;

CREATE TRIGGER t_update_pgsql_user_before_syslog_insert
    BEFORE INSERT ON logs.syslog
    FOR EACH ROW
    EXECUTE FUNCTION logs.t_override_pgsql_user ();
```

### Timeseries

Why should we bother with extensions that offer this "timeseries" capability?
Let me [quote Tembo blogpost](https://tembo.io/blog/pg-timeseries):
```
* Easily manage time-series data
* Deal with high-throughput ingest
* Answer range queries fast
* Efficiently store large amounts of data
* Run complex analytics functions
```

Additionally timeseries caps usually go hand in hand with table partitioning,
which is useful when you want to get rid of (or archive) logs that are too old.
In postgres running `DROP TABLE` for range partition is much better option than
`DELETE FROM` with specified range. Why? TL;DR because of [PostgreSQL MVCC
model](https://www.postgresql.org/docs/current/mvcc-intro.html) but there are
more nuances around this topic that I won't cover here. Let's just say that
`DROP TABLE` will be significantly faster and will free up the actual disk
space immediately.

In this tutorial we will use [timescale](https://www.timescale.com/). If it's
available for your postgres instance, this is how you can enable it:
```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
```
We will convert tables created in previous step into
[hypertables](https://docs.timescale.com/use-timescale/latest/hypertables/)
with 1 month range partitioning. Creation of new partitions will be handled by
timescale automatically on first insert that needs it - no scheduled job is
needed here.
```sql
SELECT create_hypertable(
  relation := 'logs.syslog',
  time_column_name := 'device_reported_time',
  chunk_time_interval := '1 month'::interval,
  associated_schema_name => 'logs'
);
```

### Log retention

With timescale we get one more important feature - [data
retention](https://docs.timescale.com/use-timescale/latest/data-retention/). It
allows auto deletion of logs that are older than e.g. 3 months.

```sql
SELECT add_retention_policy('logs.syslog', INTERVAL '3 months');
```

If you happen to see
```
ERROR:  function "add_retention_policy" is not supported under the current "apache" license
HINT:  Upgrade your license to 'timescale' to use this free community feature.
```
Then you can always [drop
chunks](https://docs.timescale.com/use-timescale/latest/data-retention/manually-drop-chunks/).
You don't have to do this manually, there should be `pg_cron` extension
available:
```sql
\c postgres
```
```sql
CREATE EXTENSION pg_cron with schema extensions;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
```
Let's run this operation [daily](https://crontab.guru/#0_0_*_*_*) - just in
case database was down at the time when it should be running it monthly:
```sql
SELECT cron.schedule_in_database('logs.syslog log retention', '0 0 * * *', $$
    SELECT drop_chunks('logs.syslog', INTERVAL '3 months');
$$, 'logs');
```
Now we can switch back to our database:
```sql
\c logs
```

### Permissions enforcing append-only behavior

```sql
GRANT USAGE ON SCHEMA logs TO home_rpi;
GRANT INSERT ON logs.syslog TO home_rpi;
```
```sql
GRANT USAGE ON SCHEMA logs TO home_openwrt;
GRANT INSERT ON logs.syslog TO home_openwrt;
```
Notice that we allow only `INSERT` and that each service user is limited to
`logs` schema.

## rsyslog configuration on our devices

Make sure to install [PostgreSQL Database Output Module
(ompgsql)](https://www.rsyslog.com/doc/configuration/modules/ompgsql.html). On
debian-like systems after you SSH into your device, you can do it with:
```console
sudo apt-get install rsyslog-pgsql
```

Let's configure postgres forwarder by creating `/etc/rsyslog.d/pgsql.conf`
```
### Configuration file for rsyslog-pgsql

$template SqlSyslog,"INSERT INTO logs.syslog ( \
    message, facility, from_host, priority, device_reported_time, received_at, info_unit_id, syslog_tag \
) values ( \
  '%msg%', %syslogfacility%, '%HOSTNAME%', %syslogpriority%, '%timereported:::date-rfc3339%', '%timegenerated:::date-rfc3339%', %iut%, '%syslogtag%' \
)",STDSQL

module (load="ompgsql")

*.* action(
    type="ompgsql"
    server="..."
    port="..."
    user="..."
    pass="..."
    db="logs"
    template="SqlSyslog"
)
```
`date-rfc3339` part makes sure that timezone is not lost. This is important
with logs aggregation, it's a good habit to always use UTC timezone. Checkout
[this article](https://graylog.org/post/time-zones-a-loggers-worst-nightmare/)
if you need to be convinced.

Note that you will need to replace the `...` string with correct values. Also
if your postgres provider doesn't come with secure connection by default, you
might want to switch to
[conninfo](https://www.rsyslog.com/doc/configuration/modules/ompgsql.html#conninfo)
in your rsyslog config and define [sslmode
parameter](https://www.postgresql.org/docs/current/libpq-ssl.html#LIBPQ-SSL-PROTECTION).
For example:
```
*.* action(
    type="ompgsql"
    conninfo="postgresql://USER:PASSWORD@HOSTNAME:PORT/logs?sslmode=require"
    template="sql-syslog"
)
```

Your changes will be taken into use after restart:
```console
sudo systemctl restart rsyslog.service
```

Let's doublecheck if something is ingested:
```sql
SELECT * FROM logs.syslog;
```

### Admin dashboard

It will be based on [this gist from
ceving](https://gist.github.com/ceving/4eae4437d793ae4752b8582253872067). Let's
create helper tables to have some meaningful names instead of integers:
```sql
CREATE TABLE logs.syslog_prio (
    name text,
    id smallint PRIMARY KEY
);

INSERT INTO logs.syslog_prio (id, name) VALUES
    (0, 'EMERG'),
    (1, 'ALERT'),
    (2, 'CRIT'),
    (3, 'ERR'),
    (4, 'WARN'),
    (5, 'NOTICE'),
    (6, 'INFO'),
    (7, 'DEBUG');
```
```sql
CREATE TABLE logs.syslog_facility (
    name text,
    id smallint PRIMARY KEY
);

INSERT INTO logs.syslog_facility (id, name) VALUES
    (0, 'kern'),
    (1, 'user'),
    (2, 'mail'),
    (3, 'daemon'),
    (4, 'auth'),
    (5, 'syslog'),
    (6, 'lpr'),
    (7, 'news'),
    (8, 'uucp'),
    (9, 'cron'),
    (10, 'authpriv'),
    (11, 'ftp'),
    (12, 'ntp'),
    (13, 'audit'),
    (14, 'console'),
    (15, 'cron2'),
    (16, 'local0'),
    (17, 'local1'),
    (18, 'local2'),
    (19, 'local3'),
    (20, 'local4'),
    (21, 'local5'),
    (22, 'local6'),
    (23, 'local7');
```
Admin dashboard:
```sql
CREATE VIEW logs.dashboard WITH (security_invoker = TRUE) AS
SELECT
    pgsql_user AS source,
    from_host,
    device_reported_time AS timestamp,
    coalesce(p.name, l.priority::text) AS priority,
    coalesce(f.name, l.facility::text) AS facility,
    message
FROM
    logs.syslog l
    LEFT JOIN logs.syslog_prio p ON l.priority = p.id
    LEFT JOIN logs.syslog_facility f ON l.facility = f.id
ORDER BY
    l.device_reported_time DESC;
```
Notice the `WITH (security_invoker = TRUE)` part. Views in postgres by default
are executed with privileges of the owner. [It was introduced in PostgreSQL
v15](https://www.postgresql.org/about/featurematrix/detail/389/) and it changes
how permissions are checked. If set as true, view is executed with the
privileges of the caller. This is exactly what we want in order to keep our
granular access controls.

Speaking of ACLs - last but not least - we need to add read only access for
dashboard user:
```sql
GRANT USAGE ON SCHEMA logs TO logs;
GRANT SELECT ON logs.syslog TO logs;
GRANT SELECT ON logs.syslog_prio TO logs;
GRANT SELECT ON logs.syslog_facility TO logs;
GRANT SELECT ON logs.dashboard TO logs;
```
Notice that schema name is the same as role name, we're leveraging one trick
related to the default value of `search_path`:
```sql
SHOW search_path;
         search_path
------------------------------
 "$user", public
(1 row)
```
User `logs` can now run this query:
```sql
SELECT * FROM dashboard;
```
where other users would have to run
```sql
SELECT * FROM logs.dashboard;
```

## PWNED - worse case scenario

When one of the devices gets pwned, what's the worst case scenario (at least
from our logs aggregator perspective)? At some point malicious actor can learn
the postgres credentials from `/etc/rsyslog.d/pgsql.conf` (this file should be
readable only by `root` btw).  Ok, what then? All Malice can do is flood the
table with INSERTs and eventually fill-up the disk space used by the database.

This might prevent new logs from being recorded and make the investigation more
cumbersome but hey, it's still append-only log and we should still be able to
see breach attempts and post-breach activity during our investigation.

Let's check some logs:
```console
psql postgresql://logs.otktisggmolausvmuthp@aws-0-eu-west-1.pooler.supabase.com:6543/logs
```
```sql
SELECT * FROM dashboard;
```
```
 source  | from_host |       timestamp        | priority | facility |                                                        message
---------+-----------+------------------------+----------+----------+------------------------------------------------------------------------------------------------------------------------
 home_rpi | rpi       | 2024-07-14 14:09:12+00 | INFO     | auth     |  Invalid user admin from 192.168.1.1337 port 52684
 home_rpi | rpi       | 2024-07-14 14:09:12+00 | INFO     | auth     |  Connection closed by invalid user admin 192.168.1.1337 port 52684 [preauth]
 home_rpi | rpi       | 2024-07-14 14:09:57+00 | INFO     | auth     |  Connection closed by authenticating user kuba 192.168.1.1337 port 44002 [preauth]
 home_rpi | rpi       | 2024-07-14 14:10:48+00 | INFO     | auth     |  Accepted publickey for kuba from 192.168.1.1337 port 37154 ssh2: RSA SHA256:jX3weZsOQJHG6n9M20ckM+lwpzBN3BQN3J2mGe17ZUK
 home_rpi | rpi       | 2024-07-14 14:11:02+00 | NOTICE   | authpriv |  pam_unix(sudo:auth): authentication failure; logname=kuba uid=1000 euid=0 tty=/dev/pts/2 ruser=kuba rhost=  user=kuba
 home_rpi | rpi       | 2024-07-14 14:11:10+00 | ALERT    | authpriv |      kuba : 3 incorrect password attempts ; TTY=pts/2 ; PWD=/home/kuba ; USER=root ; COMMAND=/usr/bin/passwd kuba
 home_rpi | rpi       | 2024-07-14 14:38:17+00 | NOTICE   | authpriv |      kuba : TTY=pts/0 ; PWD=/home/kuba ; USER=root ; COMMAND=/usr/bin/echo 'You\'ve got PWN3D'
 home_rpi | rpi       | 2024-07-14 14:38:17+00 | INFO     | authpriv |  pam_unix(sudo:session): session opened for user root(uid=0) by kuba(uid=1000)
 home_rpi | rpi       | 2024-07-14 14:38:17+00 | INFO     | authpriv |  pam_unix(sudo:session): session closed for user root
(6 rows)

```

## Further improvements

If you've used Supabase you can build many features on their
backend-as-a-service platform. For example:
* send alarm emails on specific log events
* integrate our dashboard with REST API that can be later used by some UI
* archive logs to [their storage](https://supabase.com/docs/guides/storage)

## Summary

That's it folks. We've learned how to use PostgreSQL as a system that ingests
logs from multiple linux machines with rsyslog. We've:
* set-up service user permissions in a way where logs can be only appended,
  preventing any log tampering attempts
* implemented additional non-repudiation mechanism
* leveraged timescale features that on one hand reduce the size of stored
  logs but also handle log retention
* finished with dedicated view for admin dashboard
* set-up read-only user that can read from dashboard view

In the future I will show you how to integrate this solution with OpenWRT - the
issue is that the upstream `rsyslog` package is not compiled with `ompgsql`
module by default.

STAY TUNED!

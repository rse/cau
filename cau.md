
# cau(1) -- Certificate Authority Utility

## SYNOPSIS

`cau`
\[`-f`|`--file` *database-file*\]
\[`-C`|`--nocolor`\]
\[`-o`|`--output` *output-file*\]
\[`-O`|`--format` `json`|`yaml`\]
*command*
\[*options*\]
\[*arguments*\]

`cau`
`version`

`cau`
`init`
\[`-s`|`--standard`\]

`cau`
`source`
\[`-r`|`--remove`\]
\[*id* \[*url*\]\]

`cau`
`import`
\[`-f`|`--cert-file` `-`|*file*|*url*\]
\[`-d`|`--cert-dir` *dir**\]

`cau`
`export`
\[`-f`|`--cert-file` `-`|*file*\]
\[`-d`|`--cert-dir` *dir*\]
\[`-n`|`--cert-names` `uuid`|`dn`\]
\[`-m`|`--manifest-file` *file*\]
\[`--manifest-dn`\]
\[`-p`|`--manifest-prefix` *prefix*\]
\[`-e`|`--exec` *command*\]

## DESCRIPTION

Certificate Authority Utility (CAU) is a small utility for managing the
X.509 certificates of Certificate Authorities (CAs), which are required
for validating certificates in the context of SSL/TLS and similar Public
Key Cryptography scenarios.

## OPTIONS

The following top-level options and arguments exist:

- \[`-f`|`--file` *database-file*\]:
  Certificate Authority Utility (CAU) is a small utility for managing the
  X.509 certificates of Certificate Authorities (CAs), which are required
  for validating certificates in the context of SSL/TLS and similar Public
  Key Cryptography scenarios.

- \[`-C`|`--nocolor`\]

- \[`-o`|`--output` *output-file*\]

- \[`-O`|`--format` *output-format*\]

- *command*

- \[*options*\]

- \[*arguments*\]

## COMMANDS

The following commands and their options and arguments exist:

### `cau export`

Export fiii bar

- \[`-f`|`--cert-file` *certificate-file*\]
  Foo bar quux

- \[`-d`|`--cert-dir` *certificate-dir*\]
- \[`-n`|`--cert-filenames` `uuid`|`dn`\]
- \[`-m`|`--manifest-file` *manifest-file*\]
- \[`--manifest-dn`\]
- \[`-p`|`--manifest-prefix` *manifest-prefix*\]
- \[`-e`|`--exec` *shell-command*\]

## ENVIRONMENT

The following environment variables are honored:

- `CAU_FILE`: default value for top-level option \[`-f|--cert-file`\].
- `CAU_NOCOLOR`: default value for top-level option \[`-C|--nocolor`\].
- `CAU_OUTPUT`: default value for top-level option \[`-o|--output`\].
- `CAU_FORMAT`: default value for top-level option \[`-O|--format`\].

## EXAMPLE

Suppose you want to easily manage standard and custom Certificate
Authority (CA) certificates in various *Docker* containers. For this the
*Docker* host imports all necessary CA certificate with:

```
cau init --standard

cau source msgcloud http://example.com/msgcloud.cer
cau source zscaler  http://example.com/zscaler.crt
cau source local    file:///app/etc/ca-example.pem

cau import
```

The *Docker* host then regularly (usually via a `cron`(8) job)
re-imports all CA certificates, and for each *Docker* container,
transfers the CA certificates into the container and exports them to
the *Debian* and/or *Alpine* GNU/Linux system with the help of their
`update-ca-certificates`(8) command:

```
cau import

cau export --cert-file - | \
    docker exec -i example cau import -

docker exec -i example cau export \
    --cert-dir /usr/share/ca-certificates/cau \
    --cert-filenames uuid \
    --manifest-file /etc/ca-certificates.conf \
    --manifest-prefix cau- \
    --exec update-ca-certificates
```

The only pre-requisite is that the `cau`(1) command is available both on
the *Docker* host and inside each *Docker* container.

As a result, the *Docker* containers at any time have all necessary CA
certificates at hand and can correctly validate their SSL/TLS-based
network connections.

## HISTORY

The `cau`(1) utility was developed in January 2020 for being able
to easily manage standand and custom Certificate Authority (CA)
certificates in various already installed *Docker* containers.

## AUTHOR

Dr. Ralf S. Engelschall <rse@engelschall.com>


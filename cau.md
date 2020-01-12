
# cau(1) -- Certificate Authority Utility

## SYNOPSIS

`cau`
\[`-d`|`--database-file` *file*\]
\[`-o`|`--output-file` *file*\]
\[`-F`|`--output-format` `json`|`yaml`\]
\[`-C`|`--output-nocolor`\]
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
\[`-d`|`--cert-dir` *dir*\]

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

- \[`-d`|`--database-file` *file*\]:
  Path to database file. It has to be created with `cau init` before use.

- \[`-o`|`--output-file` *file*\]:
  Path to output file to use instead of stdout.

- \[`-O`|`--output-format` `json`|`yaml`\]:
  Format to use for output. Default is `yaml`.

- \[`-C`|`--output-nocolor`\]:
  Strip all coloring ANSI control sequences from output.
  Default if output is sent to a non-TTY.

- *command*:
  The particular command, either `version`, `init`, `source`, `import` or `export`.

- \[*options*\]:
  The options of the command.

- \[*arguments*\]:
  The non-option arguments of the command.

## COMMANDS

The following commands and their options and arguments exist:

- `cau version`:
  Display detailed program version information.

- `cau init` \[`-s`|`--standard`\]:
  Initialize the database. Optionally, a standard cURL/Firefox source can
  be immediately configured (`--standard`) which is the same as running
  the command "`cus source standard https://curl.haxx.se/ca/cacert.pem`"
  after "`cus init`".

- `cau source`:
  Display all sources.

- `cau source` *id*:
  Display a single source.

- `cau source` *id* *url*:
  Add a source.

- `cau source` `-r`|`--remove` *id*:
  Remove a single source.

- `cau source` `-r`|`--remove`:
  Remove all sources.

- `cau` `import` \[`-f`|`--cert-file` `-`|*file*|*url*\]:
  Import one or more CA certificates from a PEM bundle on stdin, from a file or from a remote location.

- `cau` `import` \[`-d`|`--cert-dir` *dir*\]:
  Import one or more CA certificates from individual PEM files in a directory.

- `cau export` \[`-f`|`--cert-file` `-`|*file*\] \[`-e`|`--exec` *command*\]:
  Export all CA certificates as a single PEM bundle to stdout or to a
  single file. After generating the certificate files, an optional shell
  command can be executed (`--exec`).

- `cau export` \[`-d`|`--cert-dir` *dir*\]
  \[`-n`|`--cert-names` `uuid`|`dn`\]
  \[`-m`|`--manifest-file` *file*\]
  \[`--manifest-dn`\]
  \[`-p`|`--manifest-prefix` *prefix*\]
  \[`-e`|`--exec` *command*\]:
  Export all CA certificates as individual PEM files to a (pruned)
  directory (`--cert-dir`). The PEM files use either the certificate DNs
  as their filenames or UUIDs generated from the DNs (`--cert-names`).
  A manifest can be written (`--manifest-file`) which lists all
  generated files. The manifest entries can have a common prefix
  (`--manifest-prefix`) and can have a leading comment line with the
  certificate DN (`--manifest-dn`). After generating the certificate
  files, an optional shell command can be executed (`--exec`).

## ENVIRONMENT

The following environment variables are honored:

- `CAU_DATABASE_FILE`: default value for top-level option \[`-d|--database-file`\].
- `CAU_OUTPUT_FILE`: default value for top-level option \[`-o|--output-file`\].
- `CAU_OUTPUT_FORMAT`: default value for top-level option \[`-F|--output-format`\].
- `CAU_OUTPUT_NOCOLOR`: default value for top-level option \[`-C|--output-nocolor`\].

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
    docker exec -i example cau import --cert-file -

docker exec -i example cau export \
    --cert-dir /usr/share/ca-certificates/cau \
    --cert-names uuid \
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


#!/usr/bin/env node
/*!
**  CAU -- Certificate Authority Utility
**  Copyright (c) 2020 Dr. Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  own package information  */
const my          = require("./package.json")

/*  internal requirements  */
const fsConstants = require("fs").constants
const fs          = require("fs").promises
const url         = require("url")

/*  external requirements  */
const yargs       = require("yargs")
const glob        = require("glob-promise")
const execa       = require("execa")
const chalk       = require("chalk")
const stripAnsi   = require("strip-ansi")
const request     = require("request-promise-native")
const trilogy     = require("trilogy")
const x509        = require("@fidm/x509")
const moment      = require("moment")
const jsYAML      = require("js-yaml")
const UUID        = require("pure-uuid")

;(async () => {
    /*  helper function for parsing command-line options  */
    const parseArgs = (argv, config, args, handler) => {
        let obj = yargs()
            .parserConfiguration(Object.assign({}, {
                "duplicate-arguments-array": true,
                "set-placeholder-key":       true,
                "flatten-duplicate-arrays":  true,
                "camel-case-expansion":      true,
                "strip-aliased":             false,
                "dot-notation":              false
            }, config))
            .version(false)
            .help(true)
            .showHelpOnFail(true)
            .strict(true)
        obj = handler(obj)
        let options = obj.parse(argv)
        delete options.$0
        if (typeof args.min === "number" && options._.length < args.min)
            throw new Error(`too less arguments (at least ${args.min} expected)`)
        if (typeof args.max === "number" && options._.length > args.max)
            throw new Error(`too many arguments (at most ${args.max} expected)`)
        return options
    }

    /*  helper function for checking "truthy"  */
    const truthy = (value) => (
        (typeof value === "boolean" && value) ||
        (typeof value === "number" && value) ||
        (typeof value === "string" && value.match(/^(?:on|yes|true)$/i))
    )

    /*  parse global command-line options  */
    let argv = process.argv.slice(2)
    let optsGlobal = parseArgs(argv, { "halt-at-non-option": true }, { min: 1 }, (yargs) =>
        yargs.usage(
            "Usage: cau " +
            "[-f|--file <database-file>] " +
            "[-C|--nocolor] " +
            "[-o|--output <file>] " +
            "[-O|--format json|yaml] " +
            "<command> [<options>] [<arguments>]"
        )
        .option("f", {
            alias:    "file",
            type:     "string",
            describe: "package configuration to use (\"package.json\")",
            nargs:    1,
            default:  process.env["CAU_FILE"] || ""
        })
        .option("C", {
            alias:    "nocolor",
            type:     "boolean",
            describe: "do not use any colors in output",
            default:  truthy(process.env["CAU_NOCOLOR"]) || process.stdout.isTTY
        })
        .option("o", {
            alias:    "output",
            type:     "string",
            describe: "output format (\"json\" or \"yaml\")",
            nargs:    1,
            default:  process.env["CAU_OUTPUT"] || "-"
        })
        .option("O", {
            alias:    "format",
            type:     "string",
            describe: "output format (\"json\" or \"yaml\")",
            nargs:    1,
            default:  process.env["CAU_FORMAT"] || "yaml"
        })
    )

    /*  database connectivity  */
    let db = null
    let dm = {}
    const dbOpen = async () => {
        if (optsGlobal.file === "")
            throw new Error("no database file configured (use option -f)")
        db = trilogy.connect(optsGlobal.file, { client: "sql.js" })
        dm.source = await db.model("source", {
            id:        { type: String,    nullable: false, primary: true },
            url:       { type: String,    nullable: false },
            updated:   { type: String,    nullable: false }
        })
        dm.cert = await db.model("cert", {
            dn:        { type: String,    nullable: false, primary: true },
            fn:        { type: String,    nullable: false, unique: true },
            validFrom: { type: String,    nullable: false },
            validTo:   { type: String,    nullable: false },
            updated:   { type: String,    nullable: false },
            pem:       { type: String,    nullable: false },
            source:    { type: String,    nullable: false }
        })
    }
    const dbClose = async () => {
        if (db !== null)
            await db.close()
    }

    /*  helper function for generating output  */
    const output = async (out, dump) => {
        /*  optionally dump object  */
        if (dump) {
            if (optsGlobal.format === "json")
                out = JSON.stringify(out, null, "    ")
            else if (optsGlobal.format === "yaml")
                out = jsYAML.dump(out)
            else
                throw new Error("invalid output format")
        }

        /*  ensure a trailing newline  */
        if (!out.match(/\n$/))
            out += "\n"

        /*  optionally remove all colors (in case of given output and no dumping)  */
        if (!dump && optsGlobal.nocolor)
            out = stripAnsi(out)

        /*  write to stdout or to a file  */
        if (optsGlobal.output === "-") {
            await new Promise((resolve, reject) => {
                process.stdout.write(out, (err) => {
                    if (err) reject(err)
                    else     resolve()
                })
            })
        }
        else
            await fs.writeFile(optsGlobal.output, out, { flag: "a" })
    }

    /*  define commands  */
    const commands = {
        /*  command: "version"  */
        async version (optsGlobal, argv) {
            /*  parse command line options  */
            const optsCmd = parseArgs(argv, {}, { min: 0, max: 0 }, (yargs) =>
                yargs.usage("Usage: cau version")
            )

            /*  output detailed program information  */
            process.stderr.write(`CAU ${my.version} <${my.homepage}>\n`)
            process.stderr.write(`${my.description}\n`)
            process.stderr.write(`Copyright (c) 2020 ${my.author.name} <${my.author.url}>\n`)
            process.stderr.write(`Licensed under ${my.license} <http://spdx.org/licenses/${my.license}.html>\n`)
            return 0
        },

        /*  command: "init"  */
        async init (optsGlobal, argv) {
            /*  parse command line options  */
            const optsCmd = parseArgs(argv, {}, { min: 0, max: 0 }, (yargs) =>
                yargs.usage(
                    "Usage: cau init " +
                    "[-s|--standard]"
                )
                .option("s", {
                    alias:    "standard",
                    type:     "boolean",
                    describe: "add standard cURL/Firefox certificate source",
                    default:  false
                })
            )

            /*  open database connection  */
            await dbOpen()

            /*  drop all content  */
            await dm.source.clear()
            await dm.cert.clear()

            /*  optionally insert initial source  */
            if (optsCmd.standard) {
                let updated = moment().format("YYYY-MM-DDTHH:mm:ss")
                await dm.source.create({
                    id:  "standard",
                    url: "https://curl.haxx.se/ca/cacert.pem",
                    updated
                })
            }

            /*  close database connection  */
            await dbClose()
            return 0
        },

        /*  command: "source"  */
        async source (optsGlobal, argv) {
            /*  parse command line options  */
            const optsCmd = parseArgs(argv, {}, { min: 0, max: 2 }, (yargs) =>
                yargs.usage(
                    "Usage: cau source " +
                    "[-r|--remove] " +
                    "[<id> [<url>]]"
                )
                .option("r", {
                    alias:    "remove",
                    type:     "boolean",
                    describe: "remove source",
                    default:  false
                })
            )

            /*  open database connection  */
            await dbOpen()

            /*  dispatch according to operation  */
            argv = optsCmd._
            if (optsCmd.r) {
                if (argv.length === 0) {
                    /*  remove all sources  */
                    await dm.source.clear()
                }
                else if (argv.length === 1) {
                    /*  remove single source  */
                    let [ id ] = argv
                    let source = await dm.source.findOne({ id })
                    if (source === undefined)
                        throw new Error(`no source found with id "${id}"`)
                    await dm.source.remove({ id })
                }
                else
                    throw new Error("option --remove requires zero or one argument only")
            }
            else {
                if (argv.length === 2) {
                    /*  add/set single source  */
                    let [ id, url ] = argv
                    let updated = moment().format("YYYY-MM-DDTHH:mm:ss")
                    await dm.source.updateOrCreate({ id }, { id, url, updated })
                }
                else if (argv.length === 1) {
                    /*  show single source  */
                    let [ id ] = argv
                    let source = await dm.source.findOne({ id })
                    if (source === undefined)
                        throw new Error(`no source found with id "${id}"`)
                    let certs = await dm.cert.find({ source: id })
                    let out = {
                        id:      source.id,
                        url:     source.url,
                        updated: source.updated,
                        certs:   certs.length
                    }
                    await output(out, true)
                }
                else if (argv.length === 0) {
                    /*  show all sources  */
                    let sources = await dm.source.find({}, { order: "id" })
                    let out = sources.map((source) => source.id)
                    await output(out, true)
                }
            }

            /*  close database connection  */
            await dbClose()
            return 0
        },

        /*  command: "import"  */
        async import (optsGlobal, argv) {
            /*  parse command line options  */
            const optsCmd = parseArgs(argv, {}, { min: 0, max: 0 }, (yargs) =>
                yargs.usage("Usage: cau import")
            )

            /*  open database connection  */
            await dbOpen()

            /*  find all sources  */
            let sources = await dm.source.find()

            /*  generate PEM entry matching regular expression  */
            let re = new RegExp("(?:.|\r?\n)*?" +
                "-----BEGIN (?:X509 |TRUSTED )?CERTIFICATE-----\r?\n" +
                "((?:.|\r?\n)+?)" +
                "-----END (?:X509 |TRUSTED )?CERTIFICATE-----(\r?\n)?",
            "g")

            /*  drop all certificiates  */
            await dm.cert.clear()

            /*  iterate over all sources  */
            for (source of sources) {
                /*  fetch certificate bundles from remote location  */
                let body = await request({
                    uri: source.url,
                    headers: { "User-Agent": `CAU/${my.version}` }
                })

                /*  extract all certificate PEM entries  */
                let pems = []
                body = body.replace(re, (_, pem) => {
                    pem = pem.replace(/^[ \t]+/g, "").replace(/[ \t]*\r?\n/g, "\n")
                    pem = `-----BEGIN CERTIFICATE-----\n${pem}-----END CERTIFICATE-----\n`
                    pems.push(pem)
                    return ""
                })

                /*  mapping of X.509 distinguished name segments and API attributes  */
                let DN = [
                    { sn: "CN", ln: "commonName" },
                    { sn: "OU", ln: "organizationalUnitName" },
                    { sn: "O",  ln: "organizationName" },
                    { sn: "L",  ln: "localityName" },
                    { sn: "C",  ln: "countryName" }
                ]

                /*  iterate over all PEM entries  */
                for (pem of pems) {
                    /*  parse PEM entry  */
                    let cert = x509.Certificate.fromPEM(pem)

                    /*  determine distinguished name and filename  */
                    let dn = ""
                    let fn = ""
                    let sub = cert.subject
                    DN.forEach((entry) => {
                        if (typeof sub[entry.ln] === "string" && sub[entry.ln] !== "") {
                            if (dn !== "")
                                dn += ", "
                            dn += `${entry.sn}=${sub[entry.ln]}`
                            if (fn !== "")
                                fn += "-"
                            fn += sub[entry.ln].replace(/[^a-zA-Z0-9]+/g, "-")
                        }
                    })
                    fn = fn.replace(/--+/g, "-").replace(/^-/, "").replace(/-$/, "")

                    /*  determine certificate validity range  */
                    let validFrom = moment(cert.validFrom).format("YYYY-MM-DDTHH:mm:ss")
                    let validTo   = moment(cert.validTo).format("YYYY-MM-DDTHH:mm:ss")

                    /*  store certificate information  */
                    let updated   = moment().format("YYYY-MM-DDTHH:mm:ss")
                    await dm.cert.create({
                        dn, fn, validFrom, validTo, updated, pem, source: source.id
                    })
                }
            }

            /*  close database connection  */
            await dbClose()
            return 0
        },

        /*  command: "export"  */
        async export (optsGlobal, argv) {
            /*  parse command-line options  */
            const optsCmd = parseArgs(argv, {}, { min: 0, max: 0 }, (yargs) =>
                yargs.usage(
                    "Usage: cau export " +
                    "[-f|--cert-file <certificate-file>] " +
                    "[-d|--cert-dir <certificate-dir>] " +
                )
                .option("cert-file", {
                    alias:    "f",
                    type:     "string",
                    describe: "bundle file for storing certificates",
                    nargs:    1,
                    default:  ""
                })
                .option("cert-dir", {
                    alias:    "d",
                    type:     "string",
                    describe: "(exclusive) directory for storing certificates",
                    nargs:    1,
                    default:  ""
                })
                .option("cert-filenames", {
                    alias:    "n",
                    type:     "string",
                    describe: "type of certificate filenames (\"uuid\" or \"dn\")",
                    nargs:    1,
                    default:  "uuid"
                })
                .option("manifest-file", {
                    alias:    "m",
                    type:     "string",
                    describe: "(non-exclusive) file for storing manifest",
                    nargs:    1,
                    default:  ""
                })
                .option("manifest-dn", {
                    type:     "boolean",
                    describe: "add DN comment line for each manifest entry",
                    default:  false
                })
                .option("manifest-prefix", {
                    alias:    "p",
                    type:     "string",
                    describe: "path prefix for manifest entries",
                    nargs:    1,
                    default:  ""
                })
                .option("exec", {
                    alias:    "e",
                    type:     "string",
                    describe: "execute shell command after export",
                    nargs:    1,
                    default:  ""
                })
            )

            /*  open database connection  */
            await dbOpen()

            /*  find all certificates  */
            let certs = await dm.cert.find({}, { order: "dn" })

            /*  helper function for generating a certificate PEM entry  */
            const makePEM = (cert) =>
                `#   DN:      ${cert.dn}\n` +
                `#   Issued:  ${cert.validFrom}\n` +
                `#   Expires: ${cert.validTo}\n` +
                `\n` +
                `${cert.pem}\n`

            /*  dispatch according to output format  */
            if (optsCmd.certFile !== "") {
                /*
                 *  ==== generate certificate (bundle) file ====
                 */

                let generated = moment().format("YYYY-MM-DDTHH:mm:ss")
                let out =
                    "##\n" +
                    "##  Certificate Authority Certificate Bundle\n" +
                    `##  (certificates: ${certs.length}, generated: ${generated})\n` +
                    "##\n" +
                    "\n"
                for (cert of certs)
                    out += makePEM(cert)
                await fs.writeFile(optsCmd.certFile, out)
            }
            else if (optsCmd.certDir !== "") {
                /*
                 *  ==== generate certificate directory ====
                 */

                /*  ensure output directory exists  */
                let dir = optsCmd.certDir
                let exists = await fs.access(dir, fsConstants.F_OK|fsConstants.W_OK)
                    .then(() => true).catch(() => false)
                if (!exists)
                    await fs.mkdir(dir, { mode: 0o755, recursive: true })

                /*  prune existing certificate files from output directory  */
                let files = await glob(`${dir}/*`)
                for (file of files)
                    await fs.unlink(file)

                /*  iterate over all certificates  */
                let manifest = ""
                for (cert of certs) {
                    /*  determine filename  */
                    let fn
                    if (optsCmd.certFilenames === "dn")
                        fn = cert.dn
                    else if (optsCmd.certFilenames === "uuid")
                        fn = (new UUID(5, "ns:URL", cert.dn)).format("std")
                    else
                        throw new Error("invalid certificate filenames type")

                    /*  generate PEM file  */
                    let pem = makePEM(cert)
                    await fs.writeFile(`${dir}/${fn}`, pem)

                    /*  generate manifest entry  */
                    if (optsCmd.manifestFile !== "")
                        manifest +=
                            (optsCmd.manifestDn ? `# DN: ${cert.dn}\n` : "") +
                            `${optsCmd.manifestPrefix}${fn}\n`
                }

                /*  optionally update manifest  */
                if (optsCmd.manifestFile !== "") {
                    /*  the manifest block prolog/epilog  */
                    const tagOpen  = "# -----BEGIN CAU CERTIFICATE MANIFEST-----\n"
                    const tagClose = "# -----END CAU CERTIFICATE MANIFEST-----\n"

                    /*  optionally read existing manifest  */
                    let txt = ""
                    let exists = await fs.access(optsCmd.manifestFile, fsConstants.F_OK|fsConstants.R_OK|fsConstants.W_OK)
                        .then(() => true).catch(() => false)
                    if (exists)
                        txt = await fs.readFile(optsCmd.manifestFile, { encoding: "utf8" })

                    /*  generate new manifest block  */
                    const block = tagOpen + manifest + tagClose

                    /*  update generate file  */
                    const reEsc = (re) =>
                        re.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&").replace(/\n/g, "\\n")
                    const re = new RegExp(`(?<=\r?\n|)${reEsc(tagOpen)}(?:.|\r?\n)*?${reEsc(tagClose)}`)
                    if (re.test(txt))
                        txt = txt.replace(re, block)
                    else
                        txt += block
                    await fs.writeFile(optsCmd.manifestFile, txt)
                }

                /*  optionally execute post-operation shell command  */
                if (optsCmd.exec !== "")
                    await execa(optsCmd.exec, { stdio: "inherit", shell: true })
            }
            else
                throw new Error("either certificate file (--cert-file) or directory (--cert-dir) required")

            /*  close database connection  */
            await dbClose()
            return 0
        }
    }

    /*  dispatch command  */
    argv = optsGlobal._
    delete optsGlobal._
    let cmd = argv.shift()
    if (typeof commands[cmd] !== "function")
        throw new Error(`unknown command: "${cmd}"`)
    let rc = await commands[cmd](optsGlobal, argv)
    process.exit(rc)

})().catch((err) => {
    /*  fatal error  */
    process.stderr.write(`cau: ${chalk.red("ERROR:")} ${err.message}\n`)
    process.exit(1)
})


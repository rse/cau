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

/*  external requirements  */
const yargs       = require("yargs")
const glob        = require("glob-promise")
const execa       = require("execa")
const getStream   = require("get-stream")
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
    /* eslint indent: off */
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
        const options = obj.parse(argv)
        delete options.$0
        if (typeof args.min === "number" && options._.length < args.min)
            throw new Error(`too less arguments (at least ${args.min} expected)`)
        if (typeof args.max === "number" && options._.length > args.max)
            throw new Error(`too many arguments (at most ${args.max} expected)`)
        return options
    }

    /*  helper function for checking "truthy"  */
    const truthy = (value) => (
        (typeof value === "boolean" && value)
        || (typeof value === "number" && value)
        || (typeof value === "string" && value.match(/^(?:on|yes|true)$/i))
    )

    /*  parse global command-line options  */
    let argv = process.argv.slice(2)
    const optsGlobal = parseArgs(argv, { "halt-at-non-option": true }, { min: 1 }, (yargs) =>
        yargs.usage(
            "Usage: cau " +
            "[-v|--verbose <level>] " +
            "[-d|--database-file <file>] " +
            "[-o|--output-file <file>] " +
            "[-F|--output-format json|yaml] " +
            "[-C|--output-nocolor]" +
            "<command> [<options>] [<arguments>]"
        )
        .option("v", {
            alias:    "verbose",
            type:     "number",
            describe: "level of verbose output",
            nargs:    1,
            default:  parseInt(process.env["CAU_VERBOSE"] || "0")
        })
        .option("d", {
            alias:    "database-file",
            type:     "string",
            describe: "package configuration to use (\"package.json\")",
            nargs:    1,
            default:  process.env["CAU_DATABASE_FILE"] || ""
        })
        .option("o", {
            alias:    "output-file",
            type:     "string",
            describe: "output format (\"json\" or \"yaml\")",
            nargs:    1,
            default:  process.env["CAU_OUTPUT_FILE"] || "-"
        })
        .option("F", {
            alias:    "output-format",
            type:     "string",
            describe: "output format (\"json\" or \"yaml\")",
            nargs:    1,
            default:  process.env["CAU_OUTPUT_FORMAT"] || "yaml"
        })
        .option("C", {
            alias:    "output-nocolor",
            type:     "boolean",
            describe: "do not use any colors in output",
            default:  truthy(process.env["CAU_OUTPUT_NOCOLOR"]) || false
        })
    )

    /*  helper function for verbose log output  */
    const logLevels = [ "NONE", chalk.blue("INFO"), chalk.yellow("DEBUG") ]
    const log = (level, msg) => {
        if (level > 0 && level < logLevels.length && level <= optsGlobal.verbose) {
            msg = `cau: ${chalk.blue(logLevels[level])}: ${msg}\n`
            if (optsGlobal.outputNocolor || !process.stderr.isTTY)
                msg = stripAnsi(msg)
            process.stderr.write(msg)
        }
    }

    /*  database connectivity  */
    let db = null
    const dm = {}
    const dbOpen = async () => {
        /*  sanity check situation  */
        if (optsGlobal.databaseFile === "")
            throw new Error("no database file configured (use option -f)")

        /*  open database connection  */
        log(2, `connecting to SQLite database "${optsGlobal.databaseFile}"`)
        db = trilogy.connect(optsGlobal.databaseFile, { client: "sql.js" })

        /*  create database model  */
        log(2, "establishing model of SQLite database")
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
            pem:       { type: String,    nullable: false },
            url:       { type: String,    nullable: false },
            updated:   { type: String,    nullable: false }
        })
    }
    const dbClose = async () => {
        if (db !== null) {
            log(2, `disconnecting from SQLite database "${optsGlobal.databaseFile}"`)
            await db.close()
        }
    }

    /*  helper function for reading input  */
    const readInput = async (url, options = {}) => {
        options = Object.assign({}, { encoding: "utf8" }, options)
        let content
        if (url === "-" || url === "stdin:") {
            /*  read from stdin  */
            log(2, "reading from stdin")
            content = await getStream(process.stdin, options)
        }
        else if (url.match(/^https?:\/\/.+/)) {
            /*  read from URL  */
            log(2, `reading from URL "${url}"`)
            content = await request({
                uri:      url,
                encoding: options.encoding,
                headers:  { "User-Agent": `CAU/${my.version}` }
            })
        }
        else {
            /*  read from file  */
            url = url.replace(/^file:(?:\/\/)?/, "")
            log(2, `reading from file "${url}"`)
            content = await fs.readFile(url, options)
        }
        return content
    }

    /*  helper function for writing output  */
    const writeOutput = async (filename, content, options = {}) => {
        options = Object.assign({}, { encoding: "utf8" }, options)
        if (filename === "-" || filename === "stdout:") {
            /*  write to stdout  */
            log(2, "writing to stdout")
            await new Promise((resolve, reject) => {
                process.stdout.write(content, options.encoding, (err) => {
                    if (err) reject(err)
                    else     resolve()
                })
            })
        }
        else {
            /*  write to file  */
            filename = filename.replace(/^file:(?:\/\/)?/, "")
            log(2, `writing to file "${filename}"`)
            await fs.writeFile(filename, content, options)
        }
    }

    /*  helper function for generating output  */
    const output = async (out, dump = false) => {
        /*  optionally dump object  */
        if (dump) {
            if (optsGlobal.outputFormat === "json")
                out = JSON.stringify(out, null, "    ")
            else if (optsGlobal.outputFormat === "yaml")
                out = jsYAML.dump(out)
            else
                throw new Error(`invalid output format "${optsGlobal.outputFormat}"`)
        }

        /*  ensure a trailing newline  */
        if (!out.match(/\n$/))
            out += "\n"

        /*  optionally remove all colors (in case of given output and no dumping)  */
        if (!dump && (optsGlobal.outputNocolor || optsGlobal.outputFile !== "-"))
            out = stripAnsi(out)

        /*  write output  */
        return writeOutput(optsGlobal.outputFile, out, { flag: "a" })
    }

    /*  define commands  */
    const commands = {
        /*  command: "version"  */
        async version (optsGlobal, argv) {
            /*  parse command line options  */
            parseArgs(argv, {}, { min: 0, max: 0 }, (yargs) =>
                yargs.usage("Usage: cau version")
            )

            /*  output detailed program information  */
            output(
                chalk.blue.bold(`CAU ${my.version} <${my.homepage}>\n`) +
                chalk.blue(`${my.description}\n`) +
                `Copyright (c) 2020 ${my.author.name} <${my.author.url}>\n` +
                `Licensed under ${my.license} <http://spdx.org/licenses/${my.license}.html>\n`
            )
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
            log(1, "initializing database")
            await dbOpen()

            /*  drop all content  */
            log(2, "dropping all database content")
            await dm.source.clear()
            await dm.cert.clear()

            /*  optionally insert initial source  */
            if (optsCmd.standard) {
                const url = "https://curl.haxx.se/ca/cacert.pem"
                log(1, `adding source "standard" with URL "${url}"`)
                const updated = moment().format("YYYY-MM-DDTHH:mm:ss")
                await dm.source.create({ id: "standard", url, updated })
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
                    log(2, "remove all sources")
                    await dm.source.clear()
                }
                else if (argv.length === 1) {
                    /*  remove single source  */
                    const [ id ] = argv
                    const source = await dm.source.findOne({ id })
                    if (source === undefined)
                        throw new Error(`no source found with id "${id}"`)
                    log(2, `remove source "${id}"`)
                    await dm.source.remove({ id })
                }
                else
                    throw new Error("option --remove requires zero or one argument only")
            }
            else {
                if (argv.length === 2) {
                    /*  add/set single source  */
                    const [ id, url ] = argv
                    log(2, `add/set source "${id}", "${url}"`)
                    const updated = moment().format("YYYY-MM-DDTHH:mm:ss")
                    await dm.source.updateOrCreate({ id }, { id, url, updated })
                }
                else if (argv.length === 1) {
                    /*  show single source  */
                    const [ id ] = argv
                    log(2, `read source "${id}"`)
                    const source = await dm.source.findOne({ id })
                    if (source === undefined)
                        throw new Error(`no source found with id "${id}"`)
                    const certs = await dm.cert.find({ url: source.url })
                    const out = {
                        id:      source.id,
                        url:     source.url,
                        updated: source.updated,
                        certs:   certs.length
                    }
                    await output(out, true)
                }
                else if (argv.length === 0) {
                    /*  show all sources  */
                    log(2, "read all sources")
                    const sources = await dm.source.find({}, { order: "id" })
                    const out = sources.map((source) => source.id)
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
            const optsCmd = parseArgs(argv, {}, { min: 0, max: 1 }, (yargs) =>
                yargs.usage(
                    "Usage: cau import " +
                    "[-f|--cert-file -|<file>|<url>] " +
                    "[-d|--cert-dir <dir>]"
                )
                .option("cert-file", {
                    alias:    "f",
                    type:     "string",
                    describe: "bundle file for reading certificates",
                    nargs:    1,
                    default:  ""
                })
                .option("cert-dir", {
                    alias:    "d",
                    type:     "string",
                    describe: "directory for reading certificates",
                    nargs:    1,
                    default:  ""
                })
                .option("force", {
                    type:     "boolean",
                    describe: "force the removal of obsolete certificates",
                    default:  false
                })
            )

            /*  open database connection  */
            await dbOpen()

            /*  find all sources  */
            log(2, "read all sources")
            const sources = await dm.source.find()

            /*  generate PEM entry matching regular expression  */
            const re = new RegExp("(?:.|\r?\n)*?" +
                "-----BEGIN (?:X509 |TRUSTED )?CERTIFICATE-----\r?\n" +
                "((?:.|\r?\n)+?)" +
                "-----END (?:X509 |TRUSTED )?CERTIFICATE-----(\r?\n)?",
            "g")

            /*  drop all certificates  */
            log(2, "drop all certificates")

            /*  remember obsolete certificates  */
            const obsolete = {}
            const certs = await dm.cert.find()
            for (const cert of certs)
                obsolete[cert.dn] = true
            const countBefore = certs.length

            /*  helper function for importing an entire PEM bundle  */
            const importBundle = async (url, bundle) => {
                /*  extract all certificate PEM entries  */
                const pems = []
                bundle = bundle.replace(re, (_, pem) => {
                    pem = pem.replace(/^[ \t]+/g, "").replace(/[ \t]*\r?\n/g, "\n")
                    pem = `-----BEGIN CERTIFICATE-----\n${pem}-----END CERTIFICATE-----\n`
                    pems.push(pem)
                    return ""
                })

                /*  mapping of X.509 distinguished name segments and API attributes  */
                const DN = [
                    { sn: "CN", ln: "commonName" },
                    { sn: "OU", ln: "organizationalUnitName" },
                    { sn: "O",  ln: "organizationName" },
                    { sn: "L",  ln: "localityName" },
                    { sn: "C",  ln: "countryName" }
                ]

                /*  iterate over all PEM entries  */
                for (const pem of pems) {
                    /*  parse PEM entry  */
                    const cert = x509.Certificate.fromPEM(pem)

                    /*  determine distinguished name and filename  */
                    let dn = ""
                    let fn = ""
                    const sub = cert.subject
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
                    const validFrom = moment(cert.validFrom).format("YYYY-MM-DDTHH:mm:ss")
                    const validTo   = moment(cert.validTo).format("YYYY-MM-DDTHH:mm:ss")

                    /*  store certificate information  */
                    log(1, `store certificate: DN: ${dn}, issued: ${validFrom}, expires: ${validTo}`)
                    log(2, `store certificate: FN: ${fn}`)
                    const updated = moment().format("YYYY-MM-DDTHH:mm:ss")
                    await dm.cert.updateOrCreate({ dn }, {
                        dn, fn, validFrom, validTo, updated, pem, url: url
                    })
                    delete obsolete[dn]
                }
            }

            /*  dispatch according to usage  */
            if (optsCmd.certFile !== "") {
                /*  import from a single ad-hoc file or directory  */
                log(1, `loading CA certificates from file ${optsCmd.certFile}`)
                const bundle = await readInput(optsCmd.certFile)
                log(2, `PEM bundle size: ${bundle.length} bytes`)
                await importBundle(optsCmd.certFile, bundle)
            }
            else if (optsCmd.certDir !== "") {
                /*  import from a single ad-hoc directory  */
                const files = await glob(`${optsCmd.certDir}/*`)
                for (const file of files) {
                    log(1, `loading CA certificates from file ${file}`)
                    const bundle = await readInput(file)
                    log(2, `PEM bundle size: ${bundle.length} bytes`)
                    await importBundle(file, bundle)
                }
            }
            else {
                /*  iterate over all pre-defined sources  */
                for (const source of sources) {
                    /*  fetch certificate bundles from remote location  */
                    log(1, `loading CA certificates from URL ${source.url}`)
                    const bundle = await readInput(source.url)
                    log(2, `PEM bundle size: ${bundle.length} bytes`)
                    await importBundle(source.url, bundle)
                }
            }

            /*  remove obsoleted certificates  */
            const countRemove = Object.keys(obsolete).length
            if ((countRemove / countBefore) > 0.20 && !optsCmd.force)
                throw new Error("more than 20% of the certificates will be removed")
            for (const dn of Object.keys(obsolete)) {
                log(2, `removing obsolete certificate: DN: ${dn}`)
                await dm.cert.remove({ dn })
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
                    "[-f|--cert-file -|<file>] " +
                    "[-d|--cert-dir <dir>] " +
                    "[-n|--cert-filenames uuid|dn] " +
                    "[-m|--manifest-file <file>] " +
                    "[--manifest-dn] " +
                    "[-m|--manifest-prefix <prefix>] " +
                    "[-e|--exec <command>]"
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
                .option("cert-names", {
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
            log(2, "reading all certificates")
            const certs = await dm.cert.find({}, { order: "dn" })

            /*  helper function for generating a certificate PEM entry  */
            const makePEM = (cert) =>
                `#   DN:      ${cert.dn}\n` +
                `#   Issued:  ${cert.validFrom}\n` +
                `#   Expires: ${cert.validTo}\n` +
                "\n" +
                `${cert.pem}\n`

            /*  dispatch according to output format  */
            if (optsCmd.certFile !== "") {
                /*
                 *  ==== generate certificate (bundle) file ====
                 */

                const generated = moment().format("YYYY-MM-DDTHH:mm:ss")
                let out =
                    "##\n" +
                    "##  Certificate Authority Certificate Bundle\n" +
                    `##  (certificates: ${certs.length}, generated: ${generated})\n` +
                    "##\n" +
                    "\n"
                for (const cert of certs)
                    out += makePEM(cert)
                log(1, `writing certificate PEM bundle to file "${optsCmd.certFile}"`)
                await writeOutput(optsCmd.certFile, out)
            }
            else if (optsCmd.certDir !== "") {
                /*
                 *  ==== generate certificate directory ====
                 */

                /*  ensure output directory exists  */
                const dir = optsCmd.certDir
                const exists = await fs.access(dir, fsConstants.F_OK | fsConstants.W_OK)
                    .then(() => true).catch(() => false)
                if (!exists) {
                    log(1, `creating directory "${optsCmd.certDir}"`)
                    await fs.mkdir(dir, { mode: 0o755, recursive: true })
                }

                /*  prune existing certificate files from output directory  */
                const files = await glob(`${dir}/*`)
                for (const file of files) {
                    log(2, `deleting existing file "${file}"`)
                    await fs.unlink(file)
                }

                /*  iterate over all certificates  */
                let manifest = ""
                for (const cert of certs) {
                    /*  determine filename  */
                    let fn
                    if (optsCmd.certFilenames === "dn")
                        fn = cert.dn
                    else if (optsCmd.certFilenames === "uuid")
                        fn = (new UUID(5, "ns:URL", cert.dn)).format("std")
                    else
                        throw new Error("invalid certificate filenames type")

                    /*  generate PEM file  */
                    const pem = makePEM(cert)
                    log(1, `writing certificate PEM to file "${dir}/${fn}"`)
                    await writeOutput(`${dir}/${fn}`, pem)

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
                    const exists = await fs.access(optsCmd.manifestFile,
                        fsConstants.F_OK | fsConstants.R_OK | fsConstants.W_OK)
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

                    log(1, `injecting manifest into file "${optsCmd.manifestFile}"`)
                    await writeOutput(optsCmd.manifestFile, txt)
                }
            }
            else
                throw new Error("either certificate file (--cert-file) or directory (--cert-dir) required")

            /*  optionally execute post-export shell command  */
            if (optsCmd.exec !== "") {
                log(1, `executing post-export shell command "${optsCmd.exec}"`)
                await execa(optsCmd.exec, { stdio: "inherit", shell: true })
            }

            /*  close database connection  */
            await dbClose()
            return 0
        }
    }

    /*  dispatch command  */
    argv = optsGlobal._
    delete optsGlobal._
    const cmd = argv.shift()
    if (typeof commands[cmd] !== "function")
        throw new Error(`unknown command: "${cmd}"`)
    const rc = await commands[cmd](optsGlobal, argv)
    process.exit(rc)
})().catch((err) => {
    /*  fatal error  */
    process.stderr.write(`cau: ${chalk.red("ERROR:")} ${err.message}\n`)
    process.exit(1)
})


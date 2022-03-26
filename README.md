
CAU
===

**Certificate Authority Utility**

<p/>
<img src="https://nodei.co/npm/cau.png?downloads=true&stars=true" alt=""/>

<p/>
<img src="https://david-dm.org/rse/cau.png" alt=""/>

Abstract
--------

Certificate Authority Utility (CAU) is a small utility for managing the
X.509 certificates of Certificate Authorities (CAs), which are required
for validating certificates in the context of SSL/TLS and similar Public
Key Cryptography scenarios.

Installation
------------

- directly via pre-built Linux binary for Debian GNU/Linux (x64):

    ```
    $ curl -L https://github.com/rse/cau/releases/download/0.9.6/cau-linux-debian-x64.tar.xz | \
      xz -d | tar -x -f- -C /usr/sbin cau
    ```

- directly via pre-built Linux binary for Alpine GNU/Linux (x64):

    ```
    $ curl -L https://github.com/rse/cau/releases/download/0.9.6/cau-linux-alpine-x64.tar.xz | \
      xz -d | tar -x -f- -C /usr/sbin cau
    ```

- via Node.js/NPM for any platform:

    ```
    $ npm install -g cau
    ```

Usage
-----

The [Unix manual page](https://github.com/rse/cau/blob/master/cau.md) contains
detailed usage information.

License
-------

Copyright &copy; 2020-2022 Dr. Ralf S. Engelschall (http://engelschall.com/)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


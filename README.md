# 📁 Cloudflare Worker FTP Client
## workerd-ftp

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![Codecov][codecov-src]][codecov-href]

FTP Client for use inside Cloudflare Workers, using the [Cloudflare Worker TCP Sockets API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets).

This package relies *heavily* on the groundwork provided by [nullobsi/ftpdeno](https://github.com/nullobsi/ftpdeno).

* ☁️ Passive mode (as Cloudflare only supports outgoing TCP connections)
* 🔐 FTPS via TLS
* 📥 Downloading/uploading via Readable and Writable interfaces
* 📂 List files
* 🛠️ Creating directories and files
* ✏️ Renaming directories and files
* 🗑️ Deleting directories and files

**Read more about the TCP Socket connect() API in the Cloudflare Blog: https://blog.cloudflare.com/workers-tcp-socket-api-connect-databases**

## Usage

Install package:

```sh
# npm
npm install workerd-ftp

# yarn
yarn add workerd-ftp

# pnpm
pnpm install workerd-ftp

# bun
bun install workerd-ftp
```

Import:

```js
import { FTPClient } from "workerd-ftp";

const ftp = new FTPClient('$SERVER$', {
  port: 21,
  user: '$USER$',
  pass: '$PASS$',
  secure: false
})
await ftp.connect()

// get currend working directory
const cwd = await ftp.cwd()

// upload file
await ftp.upload('test.txt', new TextEncoder().encode('hello world'))

// download file
const file = await ftp.download('test.txt')
const text = new TextDecoder().decode(file)

```

## Development

- Clone this repository
- Install latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

## License

Made with 💛

Published under [MIT License](./LICENSE).

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/workerd-ftp?style=flat&colorA=18181B&colorB=F0DB4F
[npm-version-href]: https://npmjs.com/package/workerd-ftp
[npm-downloads-src]: https://img.shields.io/npm/dm/workerd-ftp?style=flat&colorA=18181B&colorB=F0DB4F
[npm-downloads-href]: https://npmjs.com/package/workerd-ftp
[codecov-src]: https://img.shields.io/codecov/c/gh/unjs/workerd-ftp/main?style=flat&colorA=18181B&colorB=F0DB4F
[codecov-href]: https://codecov.io/gh/unjs/workerd-ftp
[bundle-src]: https://img.shields.io/bundlephobia/minzip/workerd-ftp?style=flat&colorA=18181B&colorB=F0DB4F
[bundle-href]: https://bundlephobia.com/result?p=workerd-ftp

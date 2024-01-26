import "dotenv/config"
import { Writable } from "node:stream"
import { expect, describe, beforeAll, test } from "vitest"
import { build } from "unbuild"
import { Client } from "basic-ftp"
import type { FTPClient as _FTPClient } from "../src"
import buildConfig from "../build.config"
import type { ConnectionOptions } from "../src/types/connection-options"
import { createRunWorkerScript } from "./util"

// construct type of a fake FTPClient
type FTPClientConstructor = new (
  host: string,
  opts?: ConnectionOptions,
) => _FTPClient
const FTPClient = {} as FTPClientConstructor

let basicFtp: Client

beforeAll(async () => {
  // build worker script
  await build(process.cwd(), false, buildConfig?.[0])
  basicFtp = new Client()
  await basicFtp.access({
    host: process.env.SERVER,
    user: process.env.USER,
    password: process.env.PASS,
    secure: true,
  })

  const files = await basicFtp.list()
  for (const file of files) {
    await (file.isFile
      ? basicFtp.remove(file.name)
      : basicFtp.removeDir(file.name))
  }
})

const run = createRunWorkerScript(process.env as Record<string, string>)

describe("FTPClient", () => {
  test("connect", async () => {
    await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        port: 21,
        user: "$USER$",
        pass: "$PASS$",
      })

      await ftp.connect()
    })
  }, { timeout: 20_000 })

  test("listBeforeUpload", async () => {
    const list = await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        user: "$USER$",
        pass: "$PASS$",
      })
      await ftp.connect()
      return await ftp.list()
    })
    expect(list.filter((i) => !["", ".", ".."].includes(i))).toEqual([])
  }, { timeout: 20_000 })

  test(
    "textUpload",
    async () => {
      await run(async () => {
        const ftp = new FTPClient("$SERVER$", {
          port: 21,
          user: "$USER$",
          pass: "$PASS$",
        })
        await ftp.connect()
        await ftp.upload("test.txt", new TextEncoder().encode("hello world"))
      })

      // check if is present on server
      const list = await basicFtp.list()
      expect(list.map((i) => i.name)).toContain("test.txt")

      // check if content is correct
      const writable = new Writable()
      let content = ""
      writable._write = (chunk, encoding, next) => {
        content += chunk.toString()
        next()
      }

      await basicFtp.downloadTo(writable, "test.txt")
      expect(content).toEqual("hello world")
    }, { timeout: 20_000 }
  )

  test("listAfterUpload", async () => {
    const list = await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        port: 21,
        user: "$USER$",
        pass: "$PASS$",
      })
      await ftp.connect()
      return await ftp.list()
    })
    expect(list.filter((i) => !["", ".", ".."].includes(i))).toEqual([
      "test.txt",
    ])
  }, { timeout: 20_000 })

  test(
    "textDownload",
    async () => {
      const content = await run(async () => {
        const ftp = new FTPClient("$SERVER$", {
          port: 21,
          user: "$USER$",
          pass: "$PASS$",
        })
        await ftp.connect()
        const content = await ftp.download("test.txt")
        const text = new TextDecoder().decode(content)
        return text
      })
      expect(content).toEqual("hello world")
    },
    { timeout: 20_000 }
  )

  test("removeText", async () => {
    await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        port: 21,
        user: "$USER$",
        pass: "$PASS$",
      })
      await ftp.connect()
      await ftp.rm("test.txt")
    })
    const list = await basicFtp.list()
    expect(list.map((i) => i.name)).not.toContain("test.txt")
  }, { timeout: 20_000 })

  test("createDir", async () => {
    await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        port: 21,
        user: "$USER$",
        pass: "$PASS$",
      })
      await ftp.connect()
      await ftp.mkdir("test")
    })
    const list = await basicFtp.list()
    expect(list.map((i) => i.name)).toContain("test")
  }, { timeout: 20_000 })

  test("cwd", async () => {
    const cwd = await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        port: 21,
        user: "$USER$",
        pass: "$PASS$",
      })
      await ftp.connect()
      return await ftp.cwd()
    })
    expect(cwd).toEqual("/")
  }, { timeout: 20_000 })

  test("changeDir", async () => {
    const cwd = await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        port: 21,
        user: "$USER$",
        pass: "$PASS$",
      })
      await ftp.connect()
      await ftp.chdir("test")
      return await ftp.cwd()
    })
    expect(cwd).toEqual("/test")
  }, { timeout: 20_000 })

  test("cdUpDir", async () => {
    const cwd = await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        port: 21,
        user: "$USER$",
        pass: "$PASS$",
      })
      await ftp.connect()
      const outside = await ftp.cwd()
      await ftp.chdir("test")
      const inside = await ftp.cwd()
      await ftp.cdup()
      const backOutside = await ftp.cwd()
      return [outside, inside, backOutside]
    })
    expect(cwd).toEqual(["/", "/test", "/"])
  }, { timeout: 20_000 })

  test("secure", async () => {
    const cwd = await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        port: 21,
        user: "$USER$",
        pass: "$PASS$",
        secure: true,
      })
      await ftp.connect()
      return await ftp.cwd()
    })
    expect(cwd).toEqual("/")
  }, { timeout: 20_000 })

  test(
    "TODO: unsecure textUpload",
    async () => {
      await run(async () => {
        const ftp = new FTPClient("$SERVER$", {
          port: 21,
          user: "$USER$",
          pass: "$PASS$",
        })
        await ftp.connect()
        await ftp.upload("test.txt", new TextEncoder().encode("hello world"))
      })

      // check if is present on server
      const list = await basicFtp.list()
      expect(list.map((i) => i.name)).toContain("test.txt")

      // check if content is correct
      const writable = new Writable()
      let content = ""
      writable._write = (chunk, encoding, next) => {
        content += chunk.toString()
        next()
      }

      await basicFtp.downloadTo(writable, "test.txt")
      expect(content).toEqual("hello world")
    },
    { timeout: 20_000 },
  )

  test("secure download", async () => {
    const text = await run(async () => {
      const ftp = new FTPClient("$SERVER$", {
        port: 21,
        user: "$USER$",
        pass: "$PASS$",
        secure: true,
      })
      await ftp.connect()
      await ftp.cwd()
      const file = await ftp.download("test.txt")
      return new TextDecoder().decode(file)
    })
    expect(text).toEqual("hello world")
  },
    { timeout: 20_000 },
  )
})

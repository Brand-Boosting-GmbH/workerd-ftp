/* eslint-disable unicorn/no-null */
// @ts-ignore
import { connect } from "cloudflare:sockets";
import { ConnectionOptions, IntConnOpts } from "../types/connection-options";
import { Commands, StatusCodes, Types } from "../util/enums";
import * as Regexes from "../util/regexes";
import { FeatMatrix, FEATURES } from "../types/feat-matrix";
import { FTPFileInfo } from "../types/ftp-file-info";
import FTPReply from "../types/ftp-reply";
import { streamToUint8Array } from "../util/stream";
import Lock from "./lock";

export class FTPClient {
  private conn?: Socket;
  reader?: ReadableStreamDefaultReader<Uint8Array>;

  private dataConn?: Socket;

  private opts: IntConnOpts;
  private encode = new TextEncoder();

  private feats: FeatMatrix;

  private lock = new Lock();

  constructor(
    readonly host: string,
    opts?: ConnectionOptions,
  ) {
    this.feats = {} as FeatMatrix;
    const n: IntConnOpts = {
      user: "anonymous",
      pass: "anonymous",
      port: 21,
      activePort: 20,
      activeIp: "127.0.0.1",
      activeIpv6: false,
      secure: false,
    };

    if (opts) {
      if (opts.pass) {
        n.pass = opts.pass;
      }
      if (opts.port !== undefined) {
        n.port = opts.port;
      }
      if (opts.user) {
        n.user = opts.user;
      }
      if (opts.activePort !== undefined) {
        n.activePort = opts.activePort;
      }
      if (opts.activeIp) {
        n.activeIp = opts.activeIp;
      }
      if (opts.secure) {
        n.secure = opts.secure;
      }
    }
    this.opts = n;
  }

  private static notInit() {
    return new Error("Connection not initialized!");
  }

  /**
   * Initialize connection to server.
   */
  public async connect() {
    this.conn = await connect(
      {
        hostname: this.host,
        port: this.opts.port,
      },
      {
        allowHalfOpen: false,
        secureTransport: "starttls",
      },
    );

    // 1. Wait for server hello message
    let status = await this.getStatus();
    this.assertStatus(StatusCodes.Ready, status);

    // 2. Discover features
    status = await this.command(Commands.Features);

    const discoveredFeats = status.message.split("\r\n").map((a) => a.trim());
    this.feats = Object.fromEntries(
      FEATURES.map((feat) => [feat, discoveredFeats.includes(feat)]),
    ) as FeatMatrix;

    let mlst = discoveredFeats.find((v) => v.startsWith("MLST"));
    if (mlst) {
      mlst = mlst.replace("MLST ", "");
      this.feats.MLST = mlst.split(";");
    } else {
      this.feats.MLST = false;
    }

    let auth = discoveredFeats.find((v) => v.startsWith("AUTH"));
    if (auth) {
      auth = auth.replace("AUTH ", "");
      // TODO: is this right
      this.feats.AUTH = auth.split(" ");
    } else {
      this.feats.AUTH = false;
    }

    let rest = discoveredFeats.find((v) => v.startsWith("REST"));
    if (rest) {
      rest = rest.replace("REST ", "");
      this.feats.REST = rest.split(" ");
    } else {
      this.feats.REST = false;
    }

    // 3. If requested, handle TLS handshake
    if (this.opts.secure) {
      if (!this.feats.AUTH || !this.feats.AUTH.includes("TLS")) {
        console.warn(
          "Server does not advertise STARTTLS yet it was requested.\nAttempting anyways...",
        );
      }
      status = await this.command(Commands.Auth, "TLS");
      this.assertStatus(StatusCodes.AuthProceed, status, this.conn);

      this.reader?.releaseLock();
      this.reader = undefined;
      this.conn = this.conn.startTls({
        expectedServerHostname: this.host,
      });

      if (!this.feats.PROT) {
        console.warn(
          "Server does not advertise TLS streams yet it was requested.\nAttempting anyways...",
        );
      }
      // switch data channels to TLS
      status = await this.command(Commands.Protection, "P");
      this.assertStatus(StatusCodes.OK, status, this.conn);
    }

    // 4. Attempt login
    status = await this.command(Commands.User, this.opts.user);
    if (status.code !== StatusCodes.LoggedIn) {
      this.assertStatus(StatusCodes.NeedPass, status, this.conn);

      status = await this.command(Commands.Password, this.opts.pass);
      this.assertStatus(StatusCodes.LoggedIn, status, this.conn);
    }

    // 5. Switch to binary mode
    status = await this.command(Commands.Type, Types.Binary);
    this.assertStatus(StatusCodes.OK, status, this.conn);
  }

  /**
   * Current Working Directory `pwd`
   */
  public async cwd() {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }
    const res = await this.command(Commands.PWD);
    this.lock.unlock();
    this.assertStatus(StatusCodes.DirCreated, res);
    const r = Regexes.path.exec(res.message);
    if (r === null) {
      // eslint-disable-next-line no-throw-literal
      throw { error: "Could not parse server response", ...res };
    }
    return r[1];
  }

  /**
   * `cd` like command
   */
  public async chdir(path: string) {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }
    const res = await this.command(Commands.CWD, path);
    this.lock.unlock();
    this.assertStatus(StatusCodes.ActionOK, res);
  }

  /**
   * Like `cd ..`
   */
  public async cdup() {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }
    const res = await this.command(Commands.CdUp);
    this.lock.unlock();
    this.assertStatus(StatusCodes.ActionOK, res);
  }

  /**
   * Download a file from the server.
   * @param fileName
   */
  public async download(fileName: string) {
    const readable = await this.downloadReadable(fileName);
    const data = await streamToUint8Array(readable);

    await this.finalizeStream();

    return data;
  }

  /**
   * Download a file from the server using a ReadableStream interface.
   * **Please call FTPClient.finalizeStream** to release the lock
   * after the file is downloaded. Or, you can use the AsyncDispoable
   * interface.
   */
  public async downloadReadable(
    fileName: string,
  ): Promise<ReadableStream<Uint8Array>> {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }
    await this.initializeDataConnection();

    const res = await this.command(Commands.Retrieve, fileName);

    // #9 Seems there might be two possible codes, but since data
    // connection is already initialized, StartingTransfer (125)
    // seems more appropriate.
    if (
      res.code !== StatusCodes.StartTransferConnection &&
      res.code !== StatusCodes.StartingTransfer
    ) {
      this.assertStatus(StatusCodes.StartingTransfer, res, this.dataConn);
    }

    const conn = await this.finalizeDataConnection();
    return conn.readable;
  }

  /**
   * Upload a file to the server.
   * @param fileName
   * @param data
   */
  public async upload(fileName: string, data: Uint8Array) {
    const writable = await this.uploadWritable(fileName, data.byteLength);
    const writer = writable.getWriter();
    await writer.write(data);
    await writer.close();
    await this.finalizeStream();
  }

  /**
   * Upload a file using a WritableStream interface.
   * **Please call FTPClient.finalizeStream()** to release the lock after
   * the file is uploaded. Or, you can use the AsyncDispoable
   * interface.
   * @param fileName
   * @param allocate Number of bytes to allocate to the file. Some servers require this parameter.
   */
  public async uploadWritable(
    fileName: string,
    allocate?: number,
  ): Promise<WritableStream<Uint8Array>> {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }

    await this.initializeDataConnection();

    if (allocate !== undefined) {
      const res = await this.command(Commands.Allocate, allocate.toString());
      if (res.code !== 202 && res.code !== 200) {
        this.assertStatus(StatusCodes.OK, res, this.dataConn);
      }
    }

    const res = await this.command(Commands.Store, fileName);

    if (
      res.code !== StatusCodes.StartTransferConnection &&
      res.code !== StatusCodes.StartingTransfer
    ) {
      this.assertStatus(
        StatusCodes.StartTransferConnection,
        res,
        this.dataConn,
      );
    }

    const conn = await this.finalizeDataConnection();

    return conn.writable;
  }

  /**
   * Unlock and close connections for streaming.
   */
  public async finalizeStream() {
    await this.dataConn?.close();
    this.dataConn?.writable.close();
    this.dataConn = undefined;

    const res = await this.getStatus();
    this.assertStatus(StatusCodes.DataClose, res);

    this.lock.unlock();
  }

  /**
   * Obtain file information from the FTP server.
   * @param filename
   */
  public async stat(filename: string): Promise<FTPFileInfo> {
    const retn: FTPFileInfo = {
      charset: null,
      ftpType: null,
      ftpperms: null,
      lang: null,
      mediaType: null,
      atime: null,
      birthtime: null,
      blksize: null,
      blocks: null,
      dev: Number.NaN,
      gid: null,
      ino: null,
      mode: null,
      nlink: null,
      rdev: null,
      uid: null,

      isBlockDevice: null,
      isFifo: null,
      isSocket: null,
      isCharDevice: null,

      mtime: null,
      ctime: null,
      isSymlink: false,
      isFile: true,
      isDirectory: false,
      size: 0,
    };

    if (this.feats.MLST) {
      const status = await this.command(Commands.ExData, filename);
      this.assertStatus(StatusCodes.ActionOK, status);

      const entry = status.message.split("\r\n")[1];
      return this.parseMLST(entry)[1];
    } else {
      try {
        retn.size = await this.size(filename);
      } catch (error: any) {
        if (error?.code === StatusCodes.FileUnknown) {
          retn.isDirectory = true;
          retn.isFile = false;
        } else {
          throw error;
        }
      }

      if (retn.isFile) {
        retn.mtime = await this.modified(filename);
      }
    }

    return retn;
  }

  /**
   * Get file size in bytes
   * @param filename
   */
  public async size(filename: string): Promise<number> {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }

    const res = await this.command(Commands.Size, filename);
    this.assertStatus(StatusCodes.FileStat, res);

    this.lock.unlock();
    return Number.parseInt(res.message);
  }

  /**
   * Get file modification time.
   * @param filename
   */
  public async modified(filename: string): Promise<Date> {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }

    if (!this.feats.MDTM) {
      throw new Error(
        "Feature is missing. Feature MDTM is not implemented by the FTP server.",
      );
    }

    const res = await this.command(Commands.ModifiedTime, filename);
    this.assertStatus(StatusCodes.FileStat, res);
    this.lock.unlock();

    return this.parseMDTM(res.message);
  }

  /**
   * Rename a file on the server.
   * @param from
   * @param to
   */
  public async rename(from: string, to: string) {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }

    let res = await this.command(Commands.RenameFrom, from);
    this.assertStatus(StatusCodes.NeedFileInfo, res);

    res = await this.command(Commands.RenameTo, to);
    this.assertStatus(StatusCodes.ActionOK, res);

    this.lock.unlock();
    return true;
  }

  /**
   * Remove a file on the server.
   * @param fileName
   */
  public async rm(fileName: string) {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }

    const res = await this.command(Commands.Delete, fileName);
    this.assertStatus(StatusCodes.ActionOK, res);

    this.lock.unlock();
  }

  /**
   * Remove a directory on the server.
   * @param dirName
   */
  public async rmdir(dirName: string) {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }

    const res = await this.command(Commands.RMDIR, dirName);
    this.assertStatus(StatusCodes.ActionOK, res);

    this.lock.unlock();
  }

  /**
   * Create a directory on the server.
   * @param dirName
   */
  public async mkdir(dirName: string) {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }

    const res = await this.command(Commands.MKDIR, dirName);
    this.assertStatus(StatusCodes.DirCreated, res);

    this.lock.unlock();
    return true;
  }

  /**
   * Retrieve a directory listing from the server.
   * @param dirName Directory of listing (default cwd)
   */
  public async list(dirName?: string) {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }

    const listing = await this.commandWithData(Commands.PlainList, dirName);
    return listing.trimEnd().split("\r\n");
  }

  public async extendedList(dirName?: string) {
    await this.lock.lock();
    if (this.conn === undefined) {
      this.lock.unlock();
      throw FTPClient.notInit();
    }

    const listing = await this.commandWithData(Commands.ExList, dirName);
    const entries = listing.split("\r\n");

    // Discard last entry, as it is usually '' from last newline
    if (entries.at(-1)?.length === 0) {
      entries.pop();
    }

    return entries.map((e) => this.parseMLST(e));
  }

  /**
   * Please call this function when you are done to avoid loose connections.
   */
  public async close() {
    await this.lock.lock();
    this.conn?.close();
    this.conn = undefined;
    this.dataConn?.close();
    this.dataConn = undefined;
    this.lock.unlock();
  }

  // Return name, stat
  private parseMLST(input: string): [string, FTPFileInfo] {
    const retn: FTPFileInfo = {
      charset: null,
      ftpType: null,
      ftpperms: null,
      lang: null,
      mediaType: null,
      atime: null,
      birthtime: null,
      blksize: null,
      blocks: null,
      dev: Number.NaN,
      gid: null,
      ino: null,
      mode: null,
      nlink: null,
      rdev: null,
      uid: null,

      isCharDevice: null,
      isFifo: null,
      isSocket: null,
      isBlockDevice: null,

      mtime: null,
      ctime: null,
      isSymlink: false,
      isFile: true,
      isDirectory: false,
      size: 0,
    };
    const data = input.split(";");
    let filename = data.pop();
    filename = filename?.slice(1) || "";

    // No, I will not rewrite this.
    const fileStat = Object.fromEntries(
      // Lowercase the key.
      // Some implementations use lowercase or Uppercase keys.
      data.map((v) => v.split("=")).map((a) => [a[0].toLowerCase(), a[1]]),
    );

    if (fileStat.type) {
      if (fileStat.type === "file") {
        retn.isFile = true;
        retn.isDirectory = false;
      } else if (
        fileStat.type === "dir" ||
        fileStat.type === "cdir" ||
        fileStat.type === "pdir"
      ) {
        retn.isDirectory = true;
        retn.isFile = false;
      }
    }
    if (fileStat.modify) {
      retn.mtime = this.parseMDTM(fileStat.modify);
    }
    if (fileStat.create) {
      retn.ctime = this.parseMDTM(fileStat.create);
    }
    if (fileStat.perm) {
      // TODO: parse https://www.rfc-editor.org/rfc/rfc3659#section-7.1
      retn.ftpperms = fileStat.perm;
    }
    if (Number.parseInt(fileStat.size) > 0) {
      retn.size = Number.parseInt(fileStat.size);
    }
    if (fileStat["media-type"]) {
      retn.mediaType = fileStat["media-type"];
    }
    if (fileStat.charset) {
      retn.charset = fileStat.charset;
    }
    if (fileStat["unix.mode"]) {
      retn.mode = Number.parseInt(fileStat["unix.mode"]);
    }
    if (fileStat["unix.uid"]) {
      retn.uid = Number.parseInt(fileStat["unix.uid"]);
    }
    if (fileStat["unix.gid"]) {
      retn.gid = Number.parseInt(fileStat["unix.gid"]);
    }
    if (fileStat.type) {
      retn.ftpType = fileStat.type;
    }
    return [filename, retn];
  }

  private parseMDTM(date: string): Date {
    const parsed = Regexes.mdtmReply.exec(date);
    if (parsed && parsed.groups) {
      const year = Number.parseInt(parsed.groups.year);
      // Annoyingly, months are zero indexed
      const month = Number.parseInt(parsed.groups.month) - 1;
      const day = Number.parseInt(parsed.groups.day);
      const hour = Number.parseInt(parsed.groups.hour);
      const minute = Number.parseInt(parsed.groups.minute);
      const second = Number.parseInt(parsed.groups.second);
      const ms = parsed.groups.ms;
      const date = new Date(year, month, day, hour, minute, second);
      if (ms !== undefined) {
        const n = Number.parseFloat(ms);
        date.setMilliseconds(n * 1000);
      }
      return date;
    } else {
      throw new Error("Date is not in expected format.");
    }
  }

  // execute an FTP command
  private async command(c: Commands, args?: string) {
    if (!this.conn) {
      throw new Error("Connection not initialized!");
    }
    const encoded = this.encode.encode(
      `${c.toString()}${args ? " " + args : ""}\r\n`,
    );
    const writer = this.conn.writable.getWriter();
    await writer.write(encoded);

    writer.releaseLock();

    return await this.getStatus();
  }

  private async commandWithData(c: Commands, args?: string): Promise<string> {
    await this.initializeDataConnection();
    let res = await this.command(c, args);

    if (
      res.code !== StatusCodes.StartTransferConnection &&
      res.code !== StatusCodes.StartingTransfer
    ) {
      this.assertStatus(
        StatusCodes.StartTransferConnection,
        res,
        this.dataConn,
      );
    }

    const conn = await this.finalizeDataConnection();
    const text = new TextDecoder().decode(
      await streamToUint8Array(conn.readable),
    );

    res = await this.getStatus();
    this.assertStatus(StatusCodes.DataClose, res);

    this.lock.unlock();

    return text;
  }

  // parse response from FTP control channel
  private async getStatus(): Promise<FTPReply> {
    if (!this.conn) {
      throw FTPClient.notInit();
    }

    if (!this.reader) {
      this.reader = this.conn.readable.getReader();
    }

    const chunk = await this.reader.read();
    let str = new TextDecoder().decode(chunk.value);
    const isMultiLine = str.charAt(3) === "-";

    if (isMultiLine) {
      let isEndChunk = false;
      do {
        const nextChunk = await this.reader.read();
        str += new TextDecoder().decode(nextChunk.value);
        const tempLines = str.split(/\r\n|\n|\r/);
        if (tempLines.at(-1)?.length === 0) {
          tempLines.pop();
        }
        const statusCodeFirstLine = tempLines[0].slice(0, 3);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const statusCodeLastLine = tempLines.at(-1)?.slice(0, 3);
        if (
          tempLines.length > 1 &&
          statusCodeFirstLine === statusCodeLastLine
        ) {
          isEndChunk = true;
        }
      } while (!isEndChunk);
    }

    // split at any kind of newline
    const lines = str.split(/\r\n|\n|\r/);
    if (lines.at(-1)?.length === 0) {
      lines.pop();
    }

    const statusCode = Number.parseInt(lines[0].slice(0, 3));

    if (lines.length > 1) {
      const lastLine = lines.at(-1);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      lines[lines.length - 1] = lastLine!.slice(4);
    }

    const message = lines.join("\r\n").slice(4);

    return {
      code: statusCode,
      message,
    };
  }

  // eslint-disable-next-line require-await
  private async epasvStart(res: FTPReply) {
    const parsed = Regexes.extendedPort.exec(res.message);
    if (parsed === null || parsed.groups === undefined) {
      throw res;
    }
    this.dataConn = connect(
      {
        port: Number.parseInt(parsed.groups.port),
        hostname: this.host,
      },
      {
        allowHalfOpen: false,
        secureTransport: this.opts.secure ? "on" : "off",
      },
    );
  }

  private async pasvStart(res: FTPReply) {
    const parsed = Regexes.port.exec(res.message);
    if (parsed === null) {
      throw res;
    }
    this.dataConn = await connect(
      {
        port: (Number.parseInt(parsed[5]) << 8) + Number.parseInt(parsed[6]),
        hostname: `${parsed[1]}.${parsed[2]}.${parsed[3]}.${parsed[4]}`,
      },
      {
        allowHalfOpen: false,
        secureTransport: this.opts.secure ? "on" : "off",
      },
    );
  }

  // initialize data connections to server
  private async initializeDataConnection() {
    if (this.feats.EPSV) {
      const res = await this.command(Commands.ExtendedPassive);
      this.assertStatus(StatusCodes.ExtendedPassive, res);
      await this.epasvStart(res);
    } else {
      const res = await this.command(Commands.PassiveConn);

      // Some evil fucker decided PASV should return EPSV.
      // Sometimes.
      if (res.code === StatusCodes.ExtendedPassive) {
        await this.epasvStart(res);
      } else if (res.code === StatusCodes.Passive) {
        await this.pasvStart(res);
      } else {
        this.assertStatus(StatusCodes.Passive, res);
      }
    }
  }

  // finalize connection for active and initiate TLS handshake if needed.
  // eslint-disable-next-line require-await
  private async finalizeDataConnection() {
    if (this.dataConn === undefined) {
      throw new Error("Could not initialize data connection!");
    }
    return this.dataConn;
  }

  // check status or throw error
  private assertStatus(
    expected: StatusCodes,
    result: FTPReply,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...resources: (unknown | undefined)[]
  ) {
    if (result.code !== expected) {
      const errors: Error[] = [];
      this.lock.unlock();
      // eslint-disable-next-line no-throw-literal
      throw { ...result, errors };
    }
  }
}

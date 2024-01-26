const extendedPort =
  /\(([\u0021-\u007E])(?<addrFamily>\d*)\1(?<host>[\d.:A-Fa-f]*)\1(?<port>\d*)\1\)/;
const port = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/;
const path = /"(.+)"/;
const mdtmReply =
  /(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})(?<ms>\.\d+)?/;
export { extendedPort, mdtmReply, path, port };

export type FTPFileInfo = {
  ctime: Date | null;
  ftpperms: string | null;
  lang: string | null;
  mediaType: string | null;
  charset: string | null;
  ftpType: string | null;
} & {
  [key: string]: boolean | string | number | Date | null;
};

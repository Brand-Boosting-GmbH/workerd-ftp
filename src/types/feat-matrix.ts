export const FEATURES = [
  // eslint-disable-next-line unicorn/text-encoding-identifier-case
  'UTF8',
  'EPRT',
  'IDLE',
  'MDTM',
  'SIZE',
  'MFMT',
  // 'REST', // REST STREAM
  // 'MLST', // Check for MLST feats
  'MLSD',
  'PRET',
  // 'AUTH', // Check auth types
  'PBSZ',
  'PROT',
  'TVFS',
  'ESTA',
  'PASV',
  'EPSV',
  'ESTP'
] as const
export type FeatMatrix = { [x in typeof FEATURES[number]]: boolean } & {
  REST: string[] | false
  MLST: string[] | false
  AUTH: string[] | false
}

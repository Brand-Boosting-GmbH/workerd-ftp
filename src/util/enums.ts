enum Commands {
  User = "USER",
  Password = "PASS",
  CdUp = "CDUP",
  CWD = "CWD",
  Quit = "QUIT",
  Port = "PORT",
  ExtendedPort = "EPRT",
  PassiveConn = "PASV",
  ExtendedPassive = "EPSV",
  Type = "TYPE",

  Retrieve = "RETR",
  Store = "STOR",
  Allocate = "ALLO",

  RenameFrom = "RNFR",
  RenameTo = "RNTO",
  Delete = "DELE",
  RMDIR = "RMD",
  MKDIR = "MKD",
  PWD = "PWD",
  List = "LIST",
  PlainList = "NLST",
  ExList = "MLSD",
  ExData = "MLST",

  Auth = "AUTH",
  Protection = "PROT",

  Size = "SIZE",
  ModifiedTime = "MDTM",

  Features = "FEAT",
}

enum Types {
  ASCII = "A",
  EBCDIC = "E",
  Binary = "I",
}

enum StatusCodes {
  RestartMarker = 110,
  NotReady = 120,
  StartingTransfer = 125,
  StartTransferConnection = 150,

  OK = 200,
  NotImpOK = 202,
  SysStatus = 211,
  DirStatus,
  FileStat,
  HelpMessage,
  SysType,

  Ready = 220,
  Closing,
  DataOpen = 225,
  DataClose,
  Passive,
  ExtendedPassive = 229,

  LoggedIn = 230,
  AuthProceed = 234,
  ActionOK = 250,

  DirCreated = 257,

  NeedPass = 331,
  NeedAcc = 332,
  NeedFileInfo = 350,

  Unavailable = 421,
  DataFailed = 425,
  DataClosed,

  FileFailure = 450,
  FileLocalError,
  FileNoSpace,

  Error = 500,
  SyntaxError,
  NotImplemented,
  IncorrectCommandSeq,
  ParamNotImp,

  NotLoggedIn = 530,
  AccNeededToStore = 532,

  FileUnknown = 550,
  FileAbortNoStorage = 552,
  FileNameNotAllowed,
}

export { Commands, StatusCodes, Types };

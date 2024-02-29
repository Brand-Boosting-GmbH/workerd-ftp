export const detectEndChunk = (str: string) => {
  const tempLines = str.split(/\r\n|\n|\r/);
  if (tempLines.at(-1)?.length === 0) {
    tempLines.pop();
  }
  const statusCodeFirstLine = tempLines[0].slice(0, 3);
  const statusCodeLastLine = tempLines.at(-1)?.slice(0, 3);
  return tempLines.length > 1 && statusCodeFirstLine === statusCodeLastLine;
};

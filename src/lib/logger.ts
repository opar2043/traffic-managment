export const logger = {
  info: (msg: string, ...args: any[]) => console.log(msg, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(msg, ...args),
  error: (msg: string, ...args: any[]) => console.error(msg, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(msg, ...args),
};

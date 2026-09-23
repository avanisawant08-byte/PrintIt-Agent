export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static instance: Logger;
  private currentLevel: LogLevel = LogLevel.INFO;

  private constructor() {
    const envLevel = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
    if (envLevel === 'DEBUG') this.currentLevel = LogLevel.DEBUG;
    else if (envLevel === 'WARN') this.currentLevel = LogLevel.WARN;
    else if (envLevel === 'ERROR') this.currentLevel = LogLevel.ERROR;
    else this.currentLevel = LogLevel.INFO;
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  public debug(context: string, message: string, ...args: any[]): void {
    if (this.currentLevel <= LogLevel.DEBUG) {
      console.log(this.format('DEBUG', context, message), ...args.map(this.sanitizeArg));
    }
  }

  public info(context: string, message: string, ...args: any[]): void {
    if (this.currentLevel <= LogLevel.INFO) {
      console.log(this.format('INFO', context, message), ...args.map(this.sanitizeArg));
    }
  }

  public warn(context: string, message: string, ...args: any[]): void {
    if (this.currentLevel <= LogLevel.WARN) {
      console.warn(this.format('WARN', context, message), ...args.map(this.sanitizeArg));
    }
  }

  public error(context: string, message: string, ...args: any[]): void {
    if (this.currentLevel <= LogLevel.ERROR) {
      console.error(this.format('ERROR', context, message), ...args.map(this.sanitizeArg));
    }
  }

  private format(levelName: string, context: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${levelName}] [${context}] ${this.sanitize(message)}`;
  }

  /**
   * Redacts sensitive tokens, JWTs, query strings, and customer PII from log output.
   */
  public sanitize(text: string): string {
    if (!text || typeof text !== 'string') return String(text);

    return text
      // Redact Bearer headers
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
      // Redact device tokens
      .replace(/agent-jwt-[a-zA-Z0-9_\-]+/gi, '[REDACTED_AGENT_TOKEN]')
      // Redact standard JWTs
      .replace(/eyJ[a-zA-Z0-9_\-]{10,}\.eyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]+/g, '[REDACTED_JWT]')
      // Redact download/auth tokens in query parameters
      .replace(/([?&]token=)[^&\s]+/gi, '$1[REDACTED]')
      // Redact database passwords in URLs
      .replace(/:\/\/([^:]+):([^@]+)@/g, '://$1:[REDACTED]@');
  }

  private sanitizeArg = (arg: any): any => {
    if (typeof arg === 'string') {
      return this.sanitize(arg);
    }
    if (arg instanceof Error) {
      return this.sanitize(arg.message);
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.parse(this.sanitize(JSON.stringify(arg)));
      } catch {
        return '[Unserializable Object]';
      }
    }
    return arg;
  };
}

export const logger = Logger.getInstance();

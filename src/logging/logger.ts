import type { LogLevel } from '../types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ensureError, timestampLine } from '../shared/core'

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export class Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly logFilePath?: string,
  ) {
    if (this.logFilePath) {
      fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true })
    }
  }

  debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta)
  }

  info(message: string, meta?: unknown): void {
    this.write('info', message, meta)
  }

  warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta)
  }

  error(message: string, meta?: unknown): void {
    this.write('error', message, meta)
  }

  child(scope: string): ScopedLogger {
    return new ScopedLogger(this, scope)
  }

  writeScoped(level: LogLevel, scope: string, message: string, meta?: unknown): void {
    this.write(level, message, meta, scope)
  }

  private write(level: LogLevel, message: string, meta?: unknown, scope?: string): void {
    if (levelOrder[level] < levelOrder[this.level]) {
      return
    }

    const tag = scope ? `[${level.toUpperCase()}:${scope}]` : `[${level.toUpperCase()}]`
    const line = `${timestampLine()} ${tag} ${message}${meta === undefined ? '' : ` ${safeJson(meta)}`}`
    const target = level === 'error' ? process.stderr : level === 'warn' ? process.stderr : process.stdout
    target.write(`${line}\n`)

    if (this.logFilePath) {
      fs.appendFileSync(this.logFilePath, `${line}\n`, 'utf8')
    }
  }
}

export class ScopedLogger {
  constructor(
    private readonly logger: Logger,
    private readonly scope: string,
  ) {}

  debug(message: string, meta?: unknown): void {
    this.logger.writeScoped('debug', this.scope, message, meta)
  }

  info(message: string, meta?: unknown): void {
    this.logger.writeScoped('info', this.scope, message, meta)
  }

  warn(message: string, meta?: unknown): void {
    this.logger.writeScoped('warn', this.scope, message, meta)
  }

  error(message: string, meta?: unknown): void {
    this.logger.writeScoped('error', this.scope, message, meta)
  }
}

function safeJson(meta: unknown): string {
  try {
    return JSON.stringify(meta)
  }
  catch (error) {
    return JSON.stringify({ serializationError: ensureError(error).message })
  }
}

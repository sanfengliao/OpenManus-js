import { exec } from 'node:child_process'
/**
 * Union type for path-like arguments
 */
import { promises as fs } from 'node:fs'
import { promisify } from 'node:util'

export type PathLike = string

/**
 * Return type for command execution
 */
export type CommandResult = [number, string, string]

/**
 * Interface for file operations in different environments
 */
export interface FileOperator {
  /**
   * Read content from a file
   */
  readFile: (path: PathLike) => Promise<string>

  /**
   * Write content to a file
   */
  writeFile: (path: PathLike, content: string) => Promise<void>

  /**
   * Check if path points to a directory
   */
  isDirectory: (path: PathLike) => Promise<boolean>

  /**
   * Check if path exists
   */
  exists: (path: PathLike) => Promise<boolean>

  /**
   * Run a shell command and return (return_code, stdout, stderr)
   */
  runCommand: (cmd: string, timeout?: number) => Promise<CommandResult>
}

const execAsync = promisify(exec)

/**
 * File operations implementation for local filesystem
 */
export class LocalFileOperator implements FileOperator {
  private readonly encoding: BufferEncoding = 'utf-8'

  /**
   * Read content from a local file
   */
  async readFile(path: PathLike): Promise<string> {
    try {
      return await fs.readFile(path.toString(), this.encoding)
    }
    catch (e: any) {
      throw new Error(`Failed to read ${path}: ${e.message}`)
    }
  }

  /**
   * Write content to a local file
   */
  async writeFile(path: PathLike, content: string): Promise<void> {
    try {
      await fs.writeFile(path.toString(), content, this.encoding)
    }
    catch (e: any) {
      throw new Error(`Failed to write to ${path}: ${e.message}`)
    }
  }

  /**
   * Check if path points to a directory
   */
  async isDirectory(path: PathLike): Promise<boolean> {
    try {
      const stats = await fs.stat(path.toString())
      return stats.isDirectory()
    }
    catch {
      return false
    }
  }

  /**
   * Check if path exists
   */
  async exists(path: PathLike): Promise<boolean> {
    try {
      await fs.access(path.toString())
      return true
    }
    catch {
      return false
    }
  }

  /**
   * Run a shell command locally
   */
  async runCommand(cmd: string, timeout: number = 120): Promise<CommandResult> {
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: timeout * 1000 })
      return [0, stdout, stderr]
    }
    catch (error: any) {
      if (error.code === 'ETIMEDOUT') {
        throw new Error(`Command '${cmd}' timed out after ${timeout} seconds`)
      }
      return [error.code || 1, '', error.message]
    }
  }
}

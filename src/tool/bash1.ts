import type { ChildProcess } from 'node:child_process'

import { spawn } from 'node:child_process'
import { ToolError } from '../exceptions'
import { BaseTool, CLIResult } from './base'

export interface BashSessionOptions {
  command?: string
  outputDelay?: number
  timeout?: number
  sentinel?: string
}

export interface BashExecuteParams {
  command?: string
  restart?: boolean
}

export class BashSession {
  private started: boolean = false
  private timedOut: boolean = false
  private process?: ChildProcess

  private readonly command: string
  private readonly outputDelay: number
  private readonly timeout: number
  private readonly sentinel: string

  constructor(options: BashSessionOptions = {}) {
    this.command = options.command ?? '/bin/bash'
    this.outputDelay = options.outputDelay ?? 0.2
    this.timeout = options.timeout ?? 120.0
    this.sentinel = options.sentinel ?? '<<exit>>'
  }

  async start(): Promise<void> {
    if (this.started)
      return

    this.process = spawn(this.command, [], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.started = true
  }

  stop(): void {
    if (!this.started) {
      throw new ToolError('Session has not started.')
    }
    if (this.process?.exitCode !== null) {
      return
    }
    this.process?.kill()
  }

  async run(command: string): Promise<CLIResult> {
    if (!this.started || !this.process) {
      throw new ToolError('Session has not started.')
    }

    if (this.process.exitCode !== null) {
      return new CLIResult(
        undefined,
        `bash has exited with returncode ${this.process.exitCode}`,
        undefined,
        'tool must be restarted',
      )
    }

    if (this.timedOut) {
      throw new ToolError(
        `timed out: bash has not returned in ${this.timeout} seconds and must be restarted`,
      )
    }

    return new Promise((resolve, reject) => {
      let output = ''
      let error = ''
      const timeoutId = setTimeout(() => {
        this.timedOut = true
        reject(new ToolError(
          `timed out: bash has not returned in ${this.timeout} seconds and must be restarted`,
        ))
      }, this.timeout * 1000)

      this.process!.stdout?.on('data', (data) => {
        output += data.toString()
        if (output.includes(this.sentinel)) {
          output = output.substring(0, output.indexOf(this.sentinel))
          clearTimeout(timeoutId)
          resolve(new CLIResult(
            output.trimEnd(),
            error.trimEnd(),
          ))
        }
      })

      this.process!.stderr?.on('data', (data) => {
        error += data.toString()
      })

      this.process!.stdin?.write(
        `${command}; echo '${this.sentinel}'\n`,
      )
    })
  }
}

const BASH_DESCRIPTION = `Execute a bash command in the terminal.
* Long running commands: For commands that may run indefinitely, it should be run in the background and the output should be redirected to a file, e.g. command = 'python3 app.py > server.log 2>&1 &'.
* Interactive: If a bash command returns exit code '-1', this means the process is not yet finished. The assistant must then send a second call to terminal with an empty 'command' (which will retrieve any additional logs), or it can send additional text (set 'command' to the text) to STDIN of the running process, or it can send command='ctrl+c' to interrupt the process.
* Timeout: If a command execution result says "Command timed out. Sending SIGINT to the process", the assistant should retry running the command in the background.`

export class Bash extends BaseTool {
  public readonly name = 'bash'
  public readonly description = BASH_DESCRIPTION
  public readonly parameters = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute. Can be empty to view additional logs when previous exit code is \'-1\'. Can be \'ctrl+c\' to interrupt the currently running process.',
      },
    },
    required: ['command'],
  }

  private session?: BashSession

  async execute({ command, restart = false }: BashExecuteParams = {}): Promise<CLIResult> {
    if (restart) {
      if (this.session) {
        this.session.stop()
      }
      this.session = new BashSession()
      await this.session.start()
      return new CLIResult(undefined, undefined, undefined, 'tool has been restarted.')
    }

    if (!this.session) {
      this.session = new BashSession()
      await this.session.start()
    }

    if (command != null) {
      return await this.session.run(command)
    }

    throw new ToolError('no command provided.')
  }
}

if (require.main === module) {
  (async () => {
    const bash = new Bash()

    try {
    // 执行简单命令
      const result = await bash.execute({ command: 'ls -l' })
      console.log(result.toString())

      // 执行长时间运行的命令
      const bgResult = await bash.execute({
        command: 'sleep 5 && echo "Done" &',
      })
      console.log(bgResult.toString())

      // 重启会话
      const restartResult = await bash.execute({ restart: true })
      console.log(restartResult.toString())
    }
    catch (error) {
      console.error('执行出错:', error)
    }
  })()
}

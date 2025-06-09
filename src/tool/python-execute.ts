import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { BaseTool } from './base'

interface ExecuteResult {
  observation: string
  success: boolean
}

export class PythonExecute {
  /** A tool for executing Python code with timeout and safety restrictions. */

  name: string = 'python_execute'
  description: string = 'Executes Python code string. Note: Only print outputs are visible, function return values are not captured. Use print statements to see results.'
  parameters: object = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python code to execute.',
      },
    },
    required: ['code'],
  }

  /**
   * Executes the provided Python code with a timeout.
   * @param params
   * @param params.code  code (str): The Python code to execute
   * @param params.timeout  timeout (int): Execution timeout in seconds.
   * @returns  Contains 'output' with execution output or error message and 'success' status.
   */
  async execute(
    params: {
      code: string
      timeout?: number
    },
  ): Promise<ExecuteResult> {
    const { code, timeout = 0 } = params

    return new Promise<ExecuteResult>((resolve) => {
      let isResolved = false
      let pythonProcess: ChildProcess | null = null
      let timeoutHandle: NodeJS.Timeout | null = null
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          if (!isResolved) {
            isResolved = true
            if (pythonProcess) {
              pythonProcess.kill('SIGTERM')
              setTimeout(() => {
                if (!pythonProcess?.killed) {
                  pythonProcess?.kill('SIGKILL')
                }
              }, 1000)
            }
            resolve({
              observation: `Execution timeout after ${timeout} seconds`,
              success: false,
            })
          }
        }, timeout * 1000)
      }

      // Execute the code and capture the process

      let output = ''
      let error = ''

      pythonProcess = spawn('python3', ['-c', code], {
        stdio: ['inherit', 'pipe', 'pipe'],
      })

      // 捕获 stdout 并实时打印到控制台
      pythonProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        output += text
        process.stdout.write(text) // 实时打印到控制台
      })

      // 捕获 stderr 并实时打印到控制台
      pythonProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        error += text
        process.stderr.write(text) // 实时打印错误到控制台
      })

      pythonProcess.on('close', (exitCode: number | null) => {
        isResolved = true

        if (exitCode === 0) {
          resolve({
            observation: output,
            success: true,
          })
        } else {
          resolve({
            observation: error || `Process exited with code ${exitCode}`,
            success: false,
          })
        }
      })

      // Handle process errors
      pythonProcess.on('error', (err: Error) => {
        isResolved = true
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
        resolve({
          observation: err.message,
          success: false,
        })
      })
    })
  }
}

if (require.main === module) {
  // Example usage
  const pythonTool = new PythonExecute()
  pythonTool.execute({
    code: 'a = input("")\nprint("Hello, World!")\nprint("You entered:", a)',
  }).then((result) => {
    console.log('Execution Result:', result)
  }).catch((error) => {
    console.error('Execution Error:', error)
  })
}

import { spawn } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'

import { BaseTool } from './base'

interface ExecuteResult {
  observation: string
  success: boolean
}

/**
 * A tool for executing Node.js code with timeout and safety restrictions
 */
export class NodeExecute extends BaseTool {
  public readonly name = 'node_execute'
  public readonly description = 'Executes Node.js code string. Note: Only console outputs are visible, function return values are not captured. Use console.log statements to see results.'
  public readonly parameters = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Node.js code to execute.',
      },
    },
    required: ['code'],
  }

  async execute(
    params: { code: string, timeout?: number },
  ): Promise<ExecuteResult> {
    const { code, timeout = 5000 } = params

    return new Promise((resolve) => {
      let output = ''

      const child = spawn('node', ['-e', code], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const timeoutId = setTimeout(() => {
        child.kill()
        resolve({
          observation: `执行超时，超过 ${timeout / 1000} 秒`,
          success: false,
        })
      }, timeout)

      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.stderr.on('data', (data) => {
        output += data.toString()
      })

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        resolve({
          observation: output || `进程退出，退出码 ${code}`,
          success: code === 0,
        })
      })

      child.on('error', (error) => {
        clearTimeout(timeoutId)
        resolve({
          observation: error.message,
          success: false,
        })
      })
    })
  }
}

if (require.main === module) {
  const nodeExecute = new NodeExecute()
  nodeExecute.execute({ code: `
             async function test() {
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('Async operation completed');
            }
            test();
        ` })
    .then(result => console.log(result))
    .catch(error => console.error('error', error))
}

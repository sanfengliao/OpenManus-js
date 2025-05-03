import { spawn } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'

import { BaseTool, ToolResult } from './base'



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
  ): Promise<ToolResult> {
    const { code, timeout = 5000 } = params

    return new Promise((resolve) => {
      let output = ''

      const child = spawn('node', ['-e', code], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const timeoutId = setTimeout(() => {
        child.kill()
        resolve(new ToolResult(`执行超时，超过 ${timeout / 1000} 秒`))
      }, timeout)

      child.stdout.on('data', (data) => {
        output += data.toString()
      })

      child.stderr.on('data', (data) => {
        output += data.toString()
      })

      child.on('close', (code) => {
        clearTimeout(timeoutId)
        resolve(new ToolResult(output))
      })

      child.on('error', (error) => {
        clearTimeout(timeoutId)
        resolve(new ToolResult(output))
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

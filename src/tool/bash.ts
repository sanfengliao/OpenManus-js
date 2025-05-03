import { $ } from 'zx'
import { BaseTool } from './base'

const BASH_DESCRIPTION = `Execute a bash command in the terminal.
* Long running commands: For commands that may run indefinitely, it should be run in the background and the output should be redirected to a file, e.g. command = \`python3 app.py > server.log 2>&1 &\`.
* Interactive: If a bash command returns exit code \`-1\`, this means the process is not yet finished. The assistant must then send a second call to terminal with an empty \`command\` (which will retrieve any additional logs), or it can send additional text (set \`command\` to the text) to STDIN of the running process, or it can send command=\`ctrl+c\` to interrupt the process.
* Timeout: If a command execution result says "Command timed out. Sending SIGINT to the process", the assistant should retry running the command in the background.`

/**
 * A tool for executing bash commands
 */
class Bash extends BaseTool {
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

  async execute(params: any): Promise<any> {
    // @ts-expect-error
    const result = await $([params.command, ...[]])
    return result
  }
}

if (require.main === module) {
  const bash = new Bash()
  bash.execute({ command: 'cat package.json' }).then((result) => {
    console.log(result)
  })
}

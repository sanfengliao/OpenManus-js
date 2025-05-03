import { BaseTool, ToolResult } from './base'

const TERMINATE_DESCRIPTION = `Terminate the interaction when the request is met OR if the assistant cannot proceed further with the task.
When you have finished all the tasks, call this tool to end the work.`

type TerminateStatus = 'success' | 'failure'

interface TerminateParams {
  status: TerminateStatus
}

/**
 * Tool for terminating the interaction
 */
export class Terminate extends BaseTool {
  public readonly name = 'terminate'
  public readonly description = TERMINATE_DESCRIPTION
  public readonly parameters = {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'The finish status of the interaction.',
        enum: ['success', 'failure'],
      },
    },
    required: ['status'],
  }

  /**
   * Finish the current execution
   */
  async execute({ status }: TerminateParams): Promise<ToolResult> {
    return new ToolResult(`The interaction has been completed with status: ${status}`)
  }
}

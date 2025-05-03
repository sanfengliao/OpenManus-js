import type { ToolChoiceOptions } from 'openai/resources/responses/responses'
import { NEXT_STEP_PROMPT, SYSTEM_PROMPT } from '../prompt/toolcall'
import { ReactAgent } from './react'

const TOOL_CALL_REQUIRED = 'Tool calls required but none provided'

/**
 * Base agent class for handling tool/function calls with enhanced abstraction
 */
class ToolCallAgent extends ReactAgent {
  toolChoice: ToolChoiceOptions = 'auto'
  constructor() {
    super({
      name: 'ToolCallAgent',
      description: 'Agent that can execute tool calls',
      systemPrompt: SYSTEM_PROMPT,
      nextStepPrompt: NEXT_STEP_PROMPT,
    })
  }
}

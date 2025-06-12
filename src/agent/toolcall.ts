import type { ToolCall } from '../schema'
import type { BaseAgentOptions } from './base'
import { LLM } from '../llm'
import { logger } from '../logger'
import { Memory } from '../memory'
import { NEXT_STEP_PROMPT, SYSTEM_PROMPT } from '../prompt/toolcall'
import { Message } from '../schema'

import { AgentState } from '../state'
import { Terminate } from '../tool/terminal'
import { ToolCollection } from '../tool/tool-collection'
import { ReactAgent } from './react'

const TOOL_CALL_REQUIRED = 'Tool calls required but none provided'
export enum ToolChoice {
  NONE = 'none',
  AUTO = 'auto',
  REQUIRED = 'required',
}

export interface ToolCallAgentConfig extends Partial<BaseAgentOptions> {
  availableTools?: ToolCollection
  toolChoices?: ToolChoice
  specialToolNames?: string[]
  maxObserve?: number | boolean
}

/**
 * Base agent class for handling tool/function calls with enhanced abstraction
 */
export class ToolCallAgent extends ReactAgent {
  readonly toolChoices: ToolChoice
   availableTools: ToolCollection
  readonly specialToolNames: string[]
  readonly maxObserve: number | boolean | null
  toolCalls: ToolCall[] = []
  currentBase64Image: string | undefined

  constructor(config: ToolCallAgentConfig = {}) {
    super({
      name: config.name || 'ToolCallAgent',
      nextStepPrompt: config.nextStepPrompt || NEXT_STEP_PROMPT,
      systemPrompt: config.systemPrompt,
      ...config,
    })

    this.availableTools = config.availableTools || new ToolCollection(new Terminate())
    this.toolChoices = config.toolChoices || ToolChoice.AUTO
    this.specialToolNames = config.specialToolNames || [new Terminate().name]
    this.maxObserve = config.maxObserve || null
  }

  /**
   * Process current state and decide next actions using tools
   */
  async think(model?: string): Promise<boolean> {
    if (this.nextStepPrompt) {
      const userMsg = Message.userMessage(this.nextStepPrompt)
      this.messages.push(userMsg)
    }

    try {
      // Get response with tool options
      const response = await this.llm.askTool({
        messages: this.messages,
        systemMsgs: this.systemPrompt
          ? [Message.systemMessage(this.systemPrompt)]
          : undefined,
        tools: this.availableTools.toParams(),
        toolChoice: this.toolChoices,
        model,
      })

      this.toolCalls = response?.tool_calls || []
      const content = response?.content || ''

      // Log response info
      logger.info(`✨ ${this.name}'s thoughts: ${content}`)
      logger.info(`🛠️ ${this.name} selected ${this.toolCalls.length} tools to use`)

      if (this.toolCalls.length) {
        logger.info(
          `🧰 Tools being prepared: ${this.toolCalls.map(call => call.function.name)}`,
        )
        logger.info(`🔧 Tool arguments: ${this.toolCalls[0].function.arguments}`)
      }

      if (!response) {
        throw new Error('No response received from the LLM')
      }

      // Handle different tool_choices modes
      if (this.toolChoices === ToolChoice.NONE) {
        if (this.toolCalls.length) {
          logger.warn(
            `🤔 Hmm, ${this.name} tried to use tools when they weren't available!`,
          )
        }
        if (content) {
          this.memory.addMessage(Message.assistantMessage(content))
          return true
        }
        return false
      }

      // Create and add assistant message
      const assistantMsg = this.toolCalls.length
        ? Message.fromToolCalls(this.toolCalls, content)
        : Message.assistantMessage(content)

      this.memory.addMessage(assistantMsg)

      if (this.toolChoices === ToolChoice.REQUIRED && !this.toolCalls.length) {
        return true // Will be handled in act()
      }

      // For 'auto' mode, continue with content if no commands but content exists
      if (this.toolChoices === ToolChoice.AUTO && !this.toolCalls.length) {
        return Boolean(content)
      }

      return this.toolCalls.length > 0
    }
    catch (error) {
      // Check if this is a RetryError containing TokenLimitExceeded
      // if (this.isTokenLimitError(error)) {
      //   logger.error(`🚨 Token limit error (from RetryError): ${error}`)
      //   this.memory.addMessage(
      //     Message.assistantMessage(
      //       `Maximum token limit reached, cannot continue execution: ${error}`,
      //     ),
      //   )
      //   this.state = AgentState.FINISHED
      //   return false
      // }

      logger.error(`🚨 Oops! The ${this.name}'s thinking process hit a snag: ${error}`)
      this.memory.addMessage(
        Message.assistantMessage(
          `Error encountered while processing: ${error}`,
        ),
      )
      return false
    }
  }

  /**
   * Execute tool calls and handle their results
   */
  async act(): Promise<string> {
    if (!this.toolCalls) {
      if (this.toolChoices === ToolChoice.REQUIRED) {
        throw new Error(TOOL_CALL_REQUIRED)
      }
      return this.messages[this.messages.length - 1]?.content?.toString()
        || 'No content or commands to execute'
    }

    const results: string[] = []
    for (const command of this.toolCalls) {
      this.currentBase64Image = undefined

      const result = await this.executeTool(command)
      const truncatedResult = this.maxObserve
        ? result.slice(0, Number(this.maxObserve))
        : result

      logger.info(
        `🎯 Tool '${command.function.name}' completed its mission! Result: ${truncatedResult}`,
      )

      const toolMsg = Message.toolMessage({
        content: truncatedResult,
        tool_call_id: command.id,
        name: command.function.name,
        base64_image: this.currentBase64Image,
      })

      this.memory.addMessage(toolMsg)
      results.push(truncatedResult)
    }

    return results.join('\n\n')
  }

  /**
   * Execute a single tool call with robust error handling
   */
  private async executeTool(command: ToolCall): Promise<string> {
    if (!command?.function?.name) {
      return 'Error: Invalid command format'
    }

    const { name } = command.function
    if (!this.availableTools.toolMap.has(name)) {
      return `Error: Unknown tool '${name}'`
    }

    try {
      // 解析参数
      let args = command.function.arguments
      if (typeof args === 'string') {
        args = JSON.parse(args || '{}')
      }

      // 执行工具
      logger.info(`🔧 Activating tool: '${name}'...`)
      const result = await this.availableTools.execute({
        name,
        toolInput: args as Record<string, any>,
      })

      // 处理特殊工具
      await this.handleSpecialTool(name, result)

      // 检查结果是否包含 base64 图片
      if ('base64Image' in result && result.base64Image) {
        this.currentBase64Image = result.base64Image
      }

      // 格式化结果
      const observation = result
        ? `Observed output of cmd \`${name}\` executed:\n${String(result)}`
        : `Cmd \`${name}\` completed with no output`

      return observation
    }
    catch (error: any) {
      if (error instanceof SyntaxError) {
        logger.error(
          `📝 Oops! The arguments for '${name}' don't make sense - invalid JSON, arguments:${command.function.arguments}`,
        )
        return `Error: Error parsing arguments for ${name}: Invalid JSON format`
      }

      const errorMsg = `⚠️ Tool '${name}' encountered a problem: ${error.message}`
      logger.error(errorMsg)
      return `Error: ${errorMsg}`
    }
  }

  /**
   * Handle special tool execution and state changes
   */
  private async handleSpecialTool(
    name: string,
    result: any,
  ): Promise<void> {
    if (!this.isSpecialTool(name)) {
      return
    }

    if (this.shouldFinishExecution(name, result)) {
      logger.info(`🏁 Special tool '${name}' has completed the task!`)
      this.state = AgentState.FINISHED
    }
  }

  /**
   * Clean up resources used by the agent's tools
   */
  async cleanup(): Promise<void> {
    logger.info(`🧹 Cleaning up resources for agent '${this.name}'...`)

    for (const [toolName, tool] of this.availableTools.toolMap) {
      if ('cleanup' in tool && typeof tool.cleanup === 'function') {
        try {
          logger.debug(`🧼 Cleaning up tool: ${toolName}`)
          await tool.cleanup()
        }
        catch (error) {
          logger.error(
            `🚨 Error cleaning up tool '${toolName}': ${error}`,
            error,
          )
        }
      }
    }

    logger.info(`✨ Cleanup complete for agent '${this.name}'.`)
  }

  /**
   * Run the agent with cleanup when done
   */
  public async run(request?: string): Promise<string> {
    try {
      return await super.run(request)
    }
    finally {
      await this.cleanup()
    }
  }

  private isSpecialTool(name: string): boolean {
    return this.specialToolNames
      .map(n => n.toLowerCase())
      .includes(name.toLowerCase())
  }

  private shouldFinishExecution(name: string, result: any): boolean {
    return true
  }
}

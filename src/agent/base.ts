import type { ChatCompletionMessageParam } from 'openai/resources/index'
import type { IMessage } from '../scheme'
import type { Role } from '../type'
import { LLM } from '../llm'
import { logger } from '../logger'
import { Memory } from '../memory'
import { Message } from '../scheme'
import { AgentState } from '../state'

export interface BaseAgentOptions {
  name: string
  systemPrompt?: string
  nextStepPrompt?: string
  maxSteps?: number
  duplicateThreshold?: number
  llm?: LLM
  memory?: Memory
}

/**
 * abstract base class for managing agent state and execution.
 * Provides foundational functionality for state transitions, memory management,
 * and a step-based execution loop. Subclasses must implement the `step` method.
 */
export abstract class BaseAgent {
  name: string
  systemPrompt?: string
  nextStepPrompt?: string
  state: AgentState = AgentState.IDLE
  maxSteps = 10
  currentStep = 0
  duplicateThreshold = 2
  llm: LLM
  memory: Memory

  constructor({ 
    name, 
    systemPrompt,
    nextStepPrompt,
    maxSteps = 10,
    duplicateThreshold = 2,
    memory = new Memory(), 
    llm = new LLM() 
  }: BaseAgentOptions) {
    this.name = name
    this.systemPrompt = systemPrompt
    this.nextStepPrompt = nextStepPrompt
    this.maxSteps = maxSteps
    this.duplicateThreshold = duplicateThreshold
    this.memory = memory
    this.llm = llm
  }

  /**
   * Context manager for safe agent state transitions
   */
  protected async withState<T>(
    newState: AgentState,
    action: () => Promise<T>
  ): Promise<T> {
    if (!Object.values(AgentState).includes(newState)) {
      throw new Error(`Invalid state: ${newState}`);
    }

    const previousState = this.state;
    this.state = newState;

    try {
      return await action();
    } catch (error) {
      this.state = AgentState.ERROR;
      throw error;
    } finally {
      this.state = previousState;
    }
  }

  updateMemory({ role, content, toolCallId }: {
    role: Role
    content: string
    toolCallId?: string
  }) {
    if (role === 'user') {
      this.memory.addMessage(Message.userMessage(content))
    }
    else if (role === 'assistant') {
      this.memory.addMessage(Message.assistantMessage(content))
    }
    else if (role === 'tool') {
      this.memory.addMessage(Message.toolMessage({
        content,
        tool_call_id: toolCallId || '',
      }))
    }
    else if (role === 'system') {
      this.memory.addMessage(Message.systemMessage(content))
    }
  }

  /**
   * Execute the agent's main loop asynchronously.
   * @param request Optional initial user request to process.
   * @return A string summarizing the execution results.
   */
  async run(request?: string, model?: string) {
    if (this.state !== AgentState.IDLE) {
      throw new Error(`Cannot run agent from state: ${this.state}`)
    }
    if (request) {
      this.memory.addMessage(Message.userMessage(request))
    }

    const results: string[] = []

    this.withState(AgentState.RUNNING, async () => {
      while (this.currentStep < this.maxSteps && this.state !== AgentState.FINISHED) {

        this.currentStep++
        logger.info(`Executing step ${this.currentStep}/${this.maxSteps}`)
        const stepResult = await this.step(model)

        if (this.isStuck()) {
          this.handleStuckState()
        }
        results.push(`Step ${this.currentStep}: ${stepResult}`)
      }
      if (this.currentStep >= this.maxSteps) {
        this.state = AgentState.IDLE
        this.currentStep = 0
        results.push(`Terminated: Reached max steps (${this.maxSteps})`)
      }
    })
    if (results.length) {
      return results.join('\n')
    }
    return 'No steps executed'
  }
  /**
   * Execute a single step in the agent's workflow.
   * Must be implemented by subclasses to define specific behavior.
   */
  abstract step(model?: string): Promise<string>

  /**
   * Check if the agent is stuck in a loop by detecting duplicate content
   */
  isStuck() {
    if (this.memory.messages.length < 2) {
      return false
    }

    const lastMessage = this.memory.messages[this.memory.messages.length - 1]
    if (!lastMessage.content) {
      return false
    }

    // 计算相同内容出现的次数
    const duplicateCount = Array.from(this.memory.messages.slice(0, -1))
      .reverse()
      .reduce((count, msg) => {
        if (msg.role === 'assistant' && msg.content === lastMessage.content) {
          return count + 1
        }
        return count
      }, 0)

    return duplicateCount >= this.duplicateThreshold
  }

  /**
   * Handle stuck state by adding a prompt to change strategy
   */
  handleStuckState() {
    const stuckPrompt = 'Observed duplicate responses. Consider new strategies and avoid repeating ineffective paths already attempted.'
    this.nextStepPrompt = `${stuckPrompt}\n${this.nextStepPrompt}`
    logger.warn('Agent detected stuck state. Added prompt: {stuck_prompt}')
  }

  get messages() {
    return this.memory.messages
  }

  set messages(messages: IMessage[]) {
    this.memory.messages = messages
  }
}



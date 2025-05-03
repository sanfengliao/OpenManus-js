import type { ChatCompletionMessageParam } from 'openai/resources/index'
import type { Role } from '../type'
import { LLM } from '../llm'
import { logger } from '../logger'
import { Memory } from '../memory'
import { AgentState } from '../state'
import { MessageUtils } from '../utils/message'

export interface BaseAgentOptions {
  /**
   * Unique name of the agent
   */
  name: string

  /**
   * Optional agent description
   */
  description?: string

  /**
   * System-level instruction prompt
   */
  systemPrompt?: string

  /**
   * Prompt for determining next action
   */
  nextStepPrompt?: string

  /**
   * Maximum steps before termination
   */
  maxSteps?: number

  duplicateThreshold?: number

  /**
   * Language model instance
   */
  llm?: LLM
  /**
   * Agent's memory store
   */
  memory?: Memory
}

/**
 * abstract base class for managing agent state and execution.
 * Provides foundational functionality for state transitions, memory management,
 * and a step-based execution loop. Subclasses must implement the `step` method.
 */
export abstract class BaseAgent {
  /**
   * Unique name of the agent
   */
  name: string

  /**
   * Optional agent description
   */
  description?: string

  /**
   * System-level instruction prompt
   */
  systemPrompt?: string

  /**
   * Prompt for determining next action
   */
  nextStepPrompt?: string

  /**
   * Current agent state
   */
  state: AgentState = AgentState.IDLE

  /**
   * Maximum steps before termination
   */
  maxSteps = 10

  /**
   * Current step in execution
   */

  currentStep = 0

  duplicateThreshold = 2
  /**
   * Language model instance
   */
  llm: LLM
  /**
   * Agent's memory store
   */
  memory: Memory

  constructor({ name, description, memory = new Memory(), llm = new LLM() }: BaseAgentOptions) {
    this.name = name
    this.description = description
    this.memory = memory
    this.llm = llm
  }

  /**
   * Context manager for safe agent state transitions.
   * @param newState The state to transition to during the context.
   * @param fun  Allows execution function within the new state
   */
  async saveContext(newState: AgentState, fun: (...args: any[]) => any) {
    const prevState = this.state
    this.state = newState
    try {
      await fun()
    }
    catch (err) {
      this.state = AgentState.ERROR
      throw err
    }
    finally {
      this.state = prevState
    }
  }

  updateMemory({ role, content, toolCallId }: {
    role: Role
    content: string
    toolCallId?: string
  }) {
    if (role === 'user') {
      this.memory.addMessage(MessageUtils.userMessage(content))
    }
    else if (role === 'assistant') {
      this.memory.addMessage(MessageUtils.assistantMessage(content))
    }
    else if (role === 'tool') {
      this.memory.addMessage(MessageUtils.toolMessage(content, toolCallId || ''))
    }
    else if (role === 'system') {
      this.memory.addMessage(MessageUtils.systemMessage(content))
    }
  }

  /**
   * Execute the agent's main loop asynchronously.
   * @param request Optional initial user request to process.
   * @return A string summarizing the execution results.
   */
  async run(request?: string) {
    if (this.state !== AgentState.IDLE) {
      throw new Error(`Cannot run agent from state: ${this.state}`)
    }
    if (request) {
      this.memory.addMessage(MessageUtils.userMessage(request))
    }

    const results: string[] = []

    this.saveContext(AgentState.RUNNING, async () => {
      while (this.currentStep < this.maxSteps && this.state !== AgentState.FINISHED) {
        this.currentStep++
        logger.info(`Executing step ${this.currentStep}/${this.maxSteps}`)
        const stepResult = await this.step()

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
  abstract step(): Promise<string>

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

  set messages(messages: ChatCompletionMessageParam[]) {
    this.memory.messages = messages
  }
}

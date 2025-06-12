import { BaseAgent } from '../agent/base'
import { LLM } from '../llm'
import { logger } from '../logger'
import { AgentState, Message, ToolCall, ToolChoice } from '../schema'
import { PlanExecuteParams, PlanningTool } from '../tool/planing'
import { BaseFlow, FlowConfig } from './base'

export enum PlanStepStatus {
  /** Enum class defining possible statuses of a plan step */
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  BLOCKED = 'blocked',
}

export class PlanStepStatusUtils {
  /**
   *  Return a list of all possible step status values
   */
  static getAllStatuses(): string[] {
    return [PlanStepStatus.NOT_STARTED, PlanStepStatus.IN_PROGRESS, PlanStepStatus.COMPLETED, PlanStepStatus.BLOCKED]
  }

  /**
   * Return a list of values representing active statuses (not started or in progress)
   */
  static getActiveStatuses(): string[] {
    return [PlanStepStatus.NOT_STARTED, PlanStepStatus.IN_PROGRESS]
  }

  /** Return a mapping of statuses to their marker symbols */
  static getStatusMarks(): { [key: string]: string } {
    return {
      [PlanStepStatus.COMPLETED]: '[✓]',
      [PlanStepStatus.IN_PROGRESS]: '[→]',
      [PlanStepStatus.BLOCKED]: '[!]',
      [PlanStepStatus.NOT_STARTED]: '[ ]',
    }
  }
}

interface PlanData {
  title: string
  steps: string[]
  step_statuses: string[]
  step_notes: string[]
}

interface StepInfo {
  text: string
  type?: string
}

interface PlanningFlowConfig extends FlowConfig {
  llm?: LLM
  planning_tool?: PlanningTool
  executor_keys?: string[]
  active_plan_id?: string
  executors?: string[]
  plan_id?: string
}

export class PlanningFlow extends BaseFlow {
  /** A flow that manages planning and execution of tasks using agents. */

  private llm: LLM
  private planningTool: PlanningTool
  private executorKeys: string[]
  private activePlanId: string
  private currentStepIndex?: number

  constructor(
    agents: BaseAgent | BaseAgent[] | { [key: string]: BaseAgent },
        config: PlanningFlowConfig = {},
  ) {
    // Process config before calling super
    const processedConfig = { ...config }

    // Set executor keys before super().__init__
    if ('executors' in processedConfig) {
      processedConfig.executor_keys = processedConfig.executors
      delete processedConfig.executors
    }

    // Set plan ID if provided
    if ('plan_id' in processedConfig) {
      processedConfig.active_plan_id = processedConfig.plan_id
      delete processedConfig.plan_id
    }

    // Initialize the planning tool if not provided
    if (!processedConfig.planning_tool) {
      processedConfig.planning_tool = new PlanningTool()
    }

    // Call parent's init
    super(agents, processedConfig)

    // Set properties
    this.llm = processedConfig.llm || new LLM()
    this.planningTool = processedConfig.planning_tool
    this.executorKeys = processedConfig.executor_keys || []
    this.activePlanId = processedConfig.active_plan_id || `plan_${Math.floor(Date.now() / 1000)}`
    this.currentStepIndex = undefined

    // Set executor_keys to all agent keys if not specified
    if (this.executorKeys.length === 0) {
      this.executorKeys = Object.keys(this.agents)
    }
  }

  /**
   * Get an appropriate executor agent for the current step.
   * Can be extended to select agents based on step type/requirements.
   */
  getExecutor(stepType?: string): BaseAgent {
    // If step type is provided and matches an agent key, use that agent
    if (stepType && stepType in this.agents) {
      return this.agents[stepType]
    }

    // Otherwise use the first available executor or fall back to primary agent
    for (const key of this.executorKeys) {
      if (key in this.agents) {
        return this.agents[key]
      }
    }

    // Fallback to primary agent
    return this.primaryAgent!
  }

  /** Execute the planning flow with agents. */
  async execute(inputText: string): Promise<string> {
    try {
      if (!this.primaryAgent) {
        throw new Error('No primary agent available')
      }

      // Create initial plan if input provided
      if (inputText) {
        await this.createInitialPlan(inputText)

        // Verify plan was created successfully
        if (!(this.activePlanId in this.planningTool.plans)) {
          logger.error(
            `Plan creation failed. Plan ID ${this.activePlanId} not found in planning tool.`,
          )
          return `Failed to create plan for: ${inputText}`
        }
      }

      let result = ''
      while (true) {
        // Get current step to execute
        const [stepIndex, stepInfo] = await this.getCurrentStepInfo()
        this.currentStepIndex = stepIndex

        // Exit if no more steps or plan completed
        if (this.currentStepIndex === undefined) {
          result += await this.finalizePlan()
          break
        }

        // Execute current step with appropriate agent
        const stepType = stepInfo?.type
        const executor = this.getExecutor(stepType)
        const stepResult = await this.executeStep(executor, stepInfo!)
        result += `${stepResult}\n`

        // Check if agent wants to terminate
        if ('state' in executor && executor.state === AgentState.FINISHED) {
          break
        }
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Error in PlanningFlow: ${errorMessage}`)
      return `Execution failed: ${errorMessage}`
    }
  }

  /** Create an initial plan based on the request using the flow's LLM and PlanningTool. */
  private async createInitialPlan(request: string): Promise<void> {
    logger.info(`Creating initial plan with ID: ${this.activePlanId}`)

    let systemMessageContent = (
      'You are a planning assistant. Create a concise, actionable plan with clear steps. '
      + 'Focus on key milestones rather than detailed sub-steps. '
      + 'Optimize for clarity and efficiency.'
    )

    const agentsDescription = []
    for (const key of this.executorKeys) {
      if (key in this.agents) {
        agentsDescription.push({
          name: key.toUpperCase(),
          description: this.agents[key].description,
        })
      }
    }

    if (agentsDescription.length > 1) {
      // Add description of agents to select
      systemMessageContent += (
        `\nNow we have ${agentsDescription.length} agents. `
        + `The infomation of them are below: ${JSON.stringify(agentsDescription)}\n`
        + 'When creating steps in the planning tool, please specify the agent names using the format \'[agent_name]\'.'
      )
    }

    // Create a system message for plan creation
    const systemMessage = Message.systemMessage(systemMessageContent)

    // Create a user message with the request
    const userMessage = Message.userMessage(
      `Create a reasonable plan with clear steps to accomplish the task: ${request}`,
    )

    // Call LLM with PlanningTool
    const response = await this.llm.askTool({
      messages: [userMessage],
      systemMsgs: [systemMessage],
      tools: [this.planningTool.toParam()],
      toolChoice: ToolChoice.AUTO,
    })

    // Process tool calls if present
    if (response?.tool_calls) {
      for (const toolCall of response.tool_calls) {
        if (toolCall.function.name === 'planning') {
          // Parse the arguments
          let args: PlanExecuteParams
          const toolArgs = toolCall.function.arguments

          try {
            args = JSON.parse(toolArgs)
          } catch (error) {
            logger.error(`Failed to parse tool arguments: ${toolArgs}`)
            continue
          }

          // Ensure plan_id is set correctly and execute the tool
          args.plan_id = this.activePlanId

          // Execute the tool via ToolCollection instead of directly
          const result = await this.planningTool.execute(args)

          logger.info(`Plan creation result: ${String(result)}`)
          return
        }
      }
    }

    // If execution reached here, create a default plan
    logger.warning('Creating default plan')

    // Create default plan using the ToolCollection
    await this.planningTool.execute({
      command: 'create',
      plan_id: this.activePlanId,
      title: `Plan for: ${request.length > 50 ? `${request.substring(0, 50)}...` : request}`,
      steps: ['Analyze request', 'Execute task', 'Verify results'],
    })
  }

  /**
   * Parse the current plan to identify the first non-completed step's index and info.
   * Returns [undefined, undefined] if no active step is found.
   */
  private async getCurrentStepInfo(): Promise<[number | undefined, StepInfo | undefined]> {
    if (!this.activePlanId || !(this.activePlanId in this.planningTool.plans)) {
      logger.error(`Plan with ID ${this.activePlanId} not found`)
      return [undefined, undefined]
    }

    try {
      // Direct access to plan data from planning tool storage
      const planData = this.planningTool.plans[this.activePlanId] as PlanData
      const steps = planData.steps || []
      const stepStatuses = planData.step_statuses || []

      // Find first non-completed step
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        const status = i >= stepStatuses.length ? PlanStepStatus.NOT_STARTED : stepStatuses[i]

        if (PlanStepStatusUtils.getActiveStatuses().includes(status)) {
          // Extract step type/category if available
          const stepInfo: StepInfo = { text: step }

          // Try to extract step type from the text (e.g., [SEARCH] or [CODE])
          const typeMatch = step.match(/\[([A-Z_]+)\]/)
          if (typeMatch) {
            stepInfo.type = typeMatch[1].toLowerCase()
          }

          // Mark current step as in_progress
          try {
            await this.planningTool.execute({
              command: 'mark_step',
              plan_id: this.activePlanId,
              step_index: i,
              step_status: PlanStepStatus.IN_PROGRESS,
            })
          } catch (error) {
            logger.warning(`Error marking step as in_progress: ${error}`)
            // Update step status directly if needed
            if (i < stepStatuses.length) {
              stepStatuses[i] = PlanStepStatus.IN_PROGRESS
            } else {
              while (stepStatuses.length < i) {
                stepStatuses.push(PlanStepStatus.NOT_STARTED)
              }
              stepStatuses.push(PlanStepStatus.IN_PROGRESS)
            }

            planData.step_statuses = stepStatuses
          }

          return [i, stepInfo]
        }
      }

      return [undefined, undefined] // No active step found
    } catch (error) {
      logger.warning(`Error finding current step index: ${error}`)
      return [undefined, undefined]
    }
  }

  /** Execute the current step with the specified agent using agent.run(). */
  private async executeStep(executor: BaseAgent, stepInfo: StepInfo): Promise<string> {
    // Prepare context for the agent with current plan status
    const planStatus = await this.getPlanText()
    const stepText = stepInfo.text || `Step ${this.currentStepIndex}`

    // Create a prompt for the agent to execute the current step
    const stepPrompt = `
        CURRENT PLAN STATUS:
        ${planStatus}

        YOUR CURRENT TASK:
        You are now working on step ${this.currentStepIndex}: "${stepText}"

        Please only execute this current step using the appropriate tools. When you're done, provide a summary of what you accomplished.
        `

    // Use agent.run() to execute the step
    try {
      const stepResult = await executor.run(stepPrompt)

      // Mark the step as completed after successful execution
      await this.markStepCompleted()

      return stepResult
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Error executing step ${this.currentStepIndex}: ${errorMessage}`)
      return `Error executing step ${this.currentStepIndex}: ${errorMessage}`
    }
  }

  /** Mark the current step as completed. */
  private async markStepCompleted(): Promise<void> {
    if (this.currentStepIndex === undefined) {
      return
    }

    try {
      // Mark the step as completed
      await this.planningTool.execute({
        command: 'mark_step',
        plan_id: this.activePlanId,
        step_index: this.currentStepIndex,
        step_status: PlanStepStatus.COMPLETED,
      })
      logger.info(
        `Marked step ${this.currentStepIndex} as completed in plan ${this.activePlanId}`,
      )
    } catch (error) {
      logger.warning(`Failed to update plan status: ${error}`)
      // Update step status directly in planning tool storage
      if (this.activePlanId in this.planningTool.plans) {
        const planData = this.planningTool.plans[this.activePlanId] as PlanData
        const stepStatuses = planData.step_statuses || []

        // Ensure the step_statuses list is long enough
        while (stepStatuses.length <= this.currentStepIndex) {
          stepStatuses.push(PlanStepStatus.NOT_STARTED)
        }

        // Update the status
        stepStatuses[this.currentStepIndex] = PlanStepStatus.COMPLETED
        planData.step_statuses = stepStatuses
      }
    }
  }

  /** Get the current plan as formatted text. */
  private async getPlanText(): Promise<string> {
    try {
      const result = await this.planningTool.execute({
        command: 'get',
        plan_id: this.activePlanId,
      })
      return 'output' in result ? result.output! : String(result)
    } catch (error) {
      logger.error(`Error getting plan: ${error}`)
      return this.generatePlanTextFromStorage()
    }
  }

  /** Generate plan text directly from storage if the planning tool fails. */
  private generatePlanTextFromStorage(): string {
    try {
      if (!(this.activePlanId in this.planningTool.plans)) {
        return `Error: Plan with ID ${this.activePlanId} not found`
      }

      const planData = this.planningTool.plans[this.activePlanId] as PlanData
      const title = planData.title || 'Untitled Plan'
      const steps = planData.steps || []
      const stepStatuses = planData.step_statuses || []
      const stepNotes = planData.step_notes || []

      // Ensure step_statuses and step_notes match the number of steps
      while (stepStatuses.length < steps.length) {
        stepStatuses.push(PlanStepStatus.NOT_STARTED)
      }
      while (stepNotes.length < steps.length) {
        stepNotes.push('')
      }

      // Count steps by status
      const statusCounts: { [key: string]: number } = {}
      PlanStepStatusUtils.getAllStatuses().forEach((status) => {
        statusCounts[status] = 0
      })

      stepStatuses.forEach((status) => {
        if (status in statusCounts) {
          statusCounts[status]++
        }
      })

      const completed = statusCounts[PlanStepStatus.COMPLETED]
      const total = steps.length
      const progress = total > 0 ? (completed / total) * 100 : 0

      let planText = `Plan: ${title} (ID: ${this.activePlanId})\n`
      planText += `${'='.repeat(planText.length)}\n\n`

      planText += `Progress: ${completed}/${total} steps completed (${progress.toFixed(1)}%)\n`
      planText += `Status: ${statusCounts[PlanStepStatus.COMPLETED]} completed, ${statusCounts[PlanStepStatus.IN_PROGRESS]} in progress, `
      planText += `${statusCounts[PlanStepStatus.BLOCKED]} blocked, ${statusCounts[PlanStepStatus.NOT_STARTED]} not started\n\n`
      planText += 'Steps:\n'

      const statusMarks = PlanStepStatusUtils.getStatusMarks()

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        const status = stepStatuses[i]
        const notes = stepNotes[i]

        // Use status marks to indicate step status
        const statusMark = statusMarks[status] || statusMarks[PlanStepStatus.NOT_STARTED]

        planText += `${i}. ${statusMark} ${step}\n`
        if (notes) {
          planText += `   Notes: ${notes}\n`
        }
      }

      return planText
    } catch (error) {
      logger.error(`Error generating plan text from storage: ${error}`)
      return `Error: Unable to retrieve plan with ID ${this.activePlanId}`
    }
  }

  /** Finalize the plan and provide a summary using the flow's LLM directly. */
  private async finalizePlan(): Promise<string> {
    const planText = await this.getPlanText()

    // Create a summary using the flow's LLM directly
    try {
      const systemMessage = Message.systemMessage(
        'You are a planning assistant. Your task is to summarize the completed plan.',
      )

      const userMessage = Message.userMessage(
        `The plan has been completed. Here is the final plan status:\n\n${planText}\n\nPlease provide a summary of what was accomplished and any final thoughts.`,
      )

      const response = await this.llm.ask({
        messages: [userMessage],
        systemMsgs: [systemMessage],
      })

      return `Plan completed:\n\n${response}`
    } catch (error) {
      logger.error(`Error finalizing plan with LLM: ${error}`)

      // Fallback to using an agent for the summary
      try {
        const agent = this.primaryAgent!
        const summaryPrompt = `
                The plan has been completed. Here is the final plan status:

                ${planText}

                Please provide a summary of what was accomplished and any final thoughts.
                `
        const summary = await agent.run(summaryPrompt)
        return `Plan completed:\n\n${summary}`
      } catch (error2) {
        logger.error(`Error finalizing plan with agent: ${error2}`)
        return 'Plan completed. Error generating summary.'
      }
    }
  }
}

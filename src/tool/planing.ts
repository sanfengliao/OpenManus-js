import { ToolError } from '../exceptions'
import { BaseTool, ToolResult } from './base'

export type PlanStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked'
export type PlanCommand = 'create' | 'update' | 'list' | 'get' | 'set_active' | 'mark_step' | 'delete'

export interface Plan {
  plan_id: string
  title: string
  steps: string[]
  step_statuses: PlanStatus[]
  step_notes: string[]
}

export interface PlanExecuteParams {
  command: PlanCommand
  plan_id?: string
  title?: string
  steps?: string[]
  step_index?: number
  step_status?: PlanStatus
  step_notes?: string
}

const PLANNING_TOOL_DESCRIPTION = `
A planning tool that allows the agent to create and manage plans for solving complex tasks.
The tool provides functionality for creating plans, updating plan steps, and tracking progress.
`

/**
 * A planning tool that allows the agent to create and manage plans for solving complex tasks.
 * The tool provides functionality for creating plans, updating plan steps, and tracking progress.
 */
export class PlanningTool extends BaseTool {
  public readonly name = 'planning'
  public readonly description = PLANNING_TOOL_DESCRIPTION
  public readonly parameters = {
    type: 'object',
    properties: {
      command: {
        description: 'The command to execute. Available commands: create, update, list, get, set_active, mark_step, delete.',
        enum: ['create', 'update', 'list', 'get', 'set_active', 'mark_step', 'delete'],
        type: 'string',
      },
      plan_id: {
        description: 'Unique identifier for the plan. Required for create, update, set_active, and delete commands. Optional for get and mark_step (uses active plan if not specified).',
        type: 'string',
      },
      title: {
        description: 'Title for the plan. Required for create command, optional for update command.',
        type: 'string',
      },
      steps: {
        description: 'List of plan steps. Required for create command, optional for update command.',
        type: 'array',
        items: { type: 'string' },
      },
      step_index: {
        description: 'Index of the step to update (0-based). Required for mark_step command.',
        type: 'integer',
      },
      step_status: {
        description: 'Status to set for a step. Used with mark_step command.',
        enum: ['not_started', 'in_progress', 'completed', 'blocked'],
        type: 'string',
      },
      step_notes: {
        description: 'Additional notes for a step. Optional for mark_step command.',
        type: 'string',
      },
    },
    required: ['command'],
    additionalProperties: false,
  }

  private plans: Record<string, Plan> = {}
  private currentPlanId?: string

  async execute(params: PlanExecuteParams): Promise<ToolResult> {
    const { command } = params

    switch (command) {
      case 'create':
        return this.createPlan(params.plan_id, params.title, params.steps)
      case 'update':
        return this.updatePlan(params.plan_id, params.title, params.steps)
      case 'list':
        return this.listPlans()
      case 'get':
        return this.getPlan(params.plan_id)
      case 'set_active':
        return this.setActivePlan(params.plan_id)
      case 'mark_step':
        return this.markStep(params.plan_id, params.step_index, params.step_status, params.step_notes)
      case 'delete':
        return this.deletePlan(params.plan_id)
      default:
        throw new ToolError(
          `Unrecognized command: ${command}. Allowed commands are: create, update, list, get, set_active, mark_step, delete`,
        )
    }
  }

  /**
   * 格式化计划以供显示
   */
  private formatPlan(plan: Plan): string {
    let output = `Plan: ${plan.title} (ID: ${plan.plan_id})\n`
    output += `${'='.repeat(output.length)}\n\n`

    // 计算进度统计
    const totalSteps = plan.steps.length
    const completed = plan.step_statuses.filter(status => status === 'completed').length
    const inProgress = plan.step_statuses.filter(status => status === 'in_progress').length
    const blocked = plan.step_statuses.filter(status => status === 'blocked').length
    const notStarted = plan.step_statuses.filter(status => status === 'not_started').length

    output += `Progress: ${completed}/${totalSteps} steps completed `
    if (totalSteps > 0) {
      const percentage = (completed / totalSteps) * 100
      output += `(${percentage.toFixed(1)}%)\n`
    }
    else {
      output += '(0%)\n'
    }

    output += `Status: ${completed} completed, ${inProgress} in progress, ${blocked} blocked, ${notStarted} not started\n\n`
    output += 'Steps:\n'

    // 添加每个步骤及其状态和备注
    const statusSymbols: Record<PlanStatus, string> = {
      not_started: '[ ]',
      in_progress: '[→]',
      completed: '[✓]',
      blocked: '[!]',
    }

    plan.steps.forEach((step, i) => {
      const status = plan.step_statuses[i]
      const notes = plan.step_notes[i]
      const statusSymbol = statusSymbols[status]

      output += `${i}. ${statusSymbol} ${step}\n`
      if (notes) {
        output += `   Notes: ${notes}\n`
      }
    })

    return output
  }

  /**
   * 创建新计划
   */
  private createPlan(
    planId?: string,
    title?: string,
    steps?: string[],
  ): ToolResult {
    if (!planId) {
      throw new ToolError('Parameter `plan_id` is required for command: create')
    }

    if (planId in this.plans) {
      throw new ToolError(
        `A plan with ID '${planId}' already exists. Use 'update' to modify existing plans.`,
      )
    }

    if (!title) {
      throw new ToolError('Parameter `title` is required for command: create')
    }

    if (!steps?.length || !steps.every(step => typeof step === 'string')) {
      throw new ToolError(
        'Parameter `steps` must be a non-empty list of strings for command: create',
      )
    }

    // 创建新计划并初始化步骤状态
    const plan: Plan = {
      plan_id: planId,
      title,
      steps,
      step_statuses: Array.from({ length: steps.length }).fill('not_started') as any,
      step_notes: Array.from({ length: steps.length }).fill('') as any,
    }

    this.plans[planId] = plan
    this.currentPlanId = planId // 设置为活动计划

    return new ToolResult({
      status: 'success',
      output: `Plan created successfully with ID: ${planId}\n\n${this.formatPlan(plan)}`,
    })
  }

  /**
   * 更新现有计划
   */
  private updatePlan(
    planId?: string,
    title?: string,
    steps?: string[],
  ): ToolResult {
    if (!planId) {
      throw new ToolError('Parameter `plan_id` is required for command: update')
    }

    if (!(planId in this.plans)) {
      throw new ToolError(`No plan found with ID: ${planId}`)
    }

    const plan = this.plans[planId]

    if (title) {
      plan.title = title
    }

    if (steps) {
      if (!steps.every(step => typeof step === 'string')) {
        throw new ToolError(
          'Parameter `steps` must be a list of strings for command: update',
        )
      }

      // 为更改的步骤保留现有状态
      const oldSteps = plan.steps
      const oldStatuses = plan.step_statuses
      const oldNotes = plan.step_notes

      // 创建新的步骤状态和备注
      const newStatuses: PlanStatus[] = []
      const newNotes: string[] = []

      steps.forEach((step, i) => {
        if (i < oldSteps.length && step === oldSteps[i]) {
          newStatuses.push(oldStatuses[i])
          newNotes.push(oldNotes[i])
        }
        else {
          newStatuses.push('not_started')
          newNotes.push('')
        }
      })

      plan.steps = steps
      plan.step_statuses = newStatuses
      plan.step_notes = newNotes
    }

    return new ToolResult({
      status: 'success',
      output: `Plan updated successfully: ${planId}\n\n${this.formatPlan(plan)}`,
    })
  }

  /**
   * 列出所有可用计划
   */
  private listPlans(): ToolResult {
    if (Object.keys(this.plans).length === 0) {
      return new ToolResult({
        status: 'success',
        output: 'No plans available. Create a plan with the \'create\' command.',
      })
    }

    let output = 'Available plans:\n'

    Object.entries(this.plans).forEach(([planId, plan]) => {
      const currentMarker = planId === this.currentPlanId ? ' (active)' : ''
      const completed = plan.step_statuses.filter(
        status => status === 'completed',
      ).length
      const total = plan.steps.length
      const progress = `${completed}/${total} steps completed`

      output += `• ${planId}${currentMarker}: ${plan.title} - ${progress}\n`
    })

    return new ToolResult({
      status: 'success',
      output,
    })
  }

  /**
   * 获取特定计划的详细信息
   */
  private getPlan(planId?: string): ToolResult {
    if (!planId) {
      // 如果未提供计划ID，使用当前活动计划
      if (!this.currentPlanId) {
        throw new ToolError(
          'No active plan. Please specify a plan_id or set an active plan.',
        )
      }
      planId = this.currentPlanId
    }

    if (!(planId in this.plans)) {
      throw new ToolError(`No plan found with ID: ${planId}`)
    }

    return new ToolResult({
      status: 'success',
      output: this.formatPlan(this.plans[planId]),
    })
  }

  /**
   * 设置活动计划
   */
  private setActivePlan(planId?: string): ToolResult {
    if (!planId) {
      throw new ToolError('Parameter `plan_id` is required for command: set_active')
    }

    if (!(planId in this.plans)) {
      throw new ToolError(`No plan found with ID: ${planId}`)
    }

    this.currentPlanId = planId

    return new ToolResult({
      status: 'success',
      output: `Plan '${planId}' is now the active plan.\n\n${this.formatPlan(this.plans[planId])}`,
    })
  }

  /**
   * 标记步骤状态和添加备注
   */
  private markStep(
    planId?: string,
    stepIndex?: number,
    stepStatus?: PlanStatus,
    stepNotes?: string,
  ): ToolResult {
    if (!planId) {
      // 如果未提供计划ID，使用当前活动计划
      if (!this.currentPlanId) {
        throw new ToolError(
          'No active plan. Please specify a plan_id or set an active plan.',
        )
      }
      planId = this.currentPlanId
    }

    if (!(planId in this.plans)) {
      throw new ToolError(`No plan found with ID: ${planId}`)
    }

    if (typeof stepIndex !== 'number') {
      throw new ToolError('Parameter `step_index` is required for command: mark_step')
    }

    const plan = this.plans[planId]

    if (stepIndex < 0 || stepIndex >= plan.steps.length) {
      throw new ToolError(
        `Invalid step_index: ${stepIndex}. Valid indices range from 0 to ${plan.steps.length - 1}.`,
      )
    }

    if (stepStatus && !['not_started', 'in_progress', 'completed', 'blocked'].includes(stepStatus)) {
      throw new ToolError(
        `Invalid step_status: ${stepStatus}. Valid statuses are: not_started, in_progress, completed, blocked`,
      )
    }

    if (stepStatus) {
      plan.step_statuses[stepIndex] = stepStatus
    }

    if (stepNotes) {
      plan.step_notes[stepIndex] = stepNotes
    }

    return new ToolResult({
      status: 'success',
      output: `Step ${stepIndex} updated in plan '${planId}'.\n\n${this.formatPlan(plan)}`,
    })
  }

  /**
   * 删除计划
   */
  private deletePlan(planId?: string): ToolResult {
    if (!planId) {
      throw new ToolError('Parameter `plan_id` is required for command: delete')
    }

    if (!(planId in this.plans)) {
      throw new ToolError(`No plan found with ID: ${planId}`)
    }

    delete this.plans[planId]

    // 如果删除的是当前活动计划，清除活动计划
    if (this.currentPlanId === planId) {
      this.currentPlanId = undefined
    }

    return new ToolResult({
      status: 'success',
      output: `Plan '${planId}' has been deleted.`,
    })
  }
}

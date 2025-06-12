import { BaseAgent } from '../agent/base'
import { LLM } from '../llm'
import { PlanningTool } from '../tool/planing'

export interface FlowConfig {
  tools?: any[]
  primary_agent_key?: string
}

/**
 * Base class for execution flows supporting multiple agents
 */
export abstract class BaseFlow {
  protected agents: { [key: string]: BaseAgent }
  protected tools?: any[]
  protected primaryAgentKey?: string

  constructor(
    agents: BaseAgent | BaseAgent[] | { [key: string]: BaseAgent },
    config: Partial<FlowConfig> = {},
  ) {
    // Handle different ways of providing agents
    let agentsDict: { [key: string]: BaseAgent }

    if (agents instanceof BaseAgent) {
      agentsDict = { default: agents }
    } else if (Array.isArray(agents)) {
      agentsDict = {}
      agents.forEach((agent, i) => {
        agentsDict[`agent_${i}`] = agent
      })
    } else {
      agentsDict = agents
    }

    // If primary agent not specified, use first agent
    let primaryKey = config.primary_agent_key
    if (!primaryKey && Object.keys(agentsDict).length > 0) {
      primaryKey = Object.keys(agentsDict)[0]
    }

    // Set properties
    this.agents = agentsDict
    this.tools = config.tools
    this.primaryAgentKey = primaryKey
  }

  /**
   * Get the primary agent for the flow
   */
  get primaryAgent(): BaseAgent | undefined {
    if (!this.primaryAgentKey) {
      return undefined
    }
    return this.agents[this.primaryAgentKey]
  }

  /**
   * Get a specific agent by key
   */
  getAgent(key: string): BaseAgent | undefined {
    return this.agents[key]
  }

  /**
   *  Add a new agent to the flow
   */
  addAgent(key: string, agent: BaseAgent): void {
    this.agents[key] = agent
  }

  /** Execute the flow with given input */
  abstract execute(inputText: string): Promise<string>
}

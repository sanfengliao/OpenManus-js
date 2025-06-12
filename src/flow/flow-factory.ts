import { BaseAgent } from '../agent/base'
import { BaseFlow } from './base'
import { PlanningFlow } from './planning'

export enum FlowType {
  PLANNING = 'planning',
}

type FlowConstructor = new (
  agents: BaseAgent | BaseAgent[] | { [key: string]: BaseAgent },
  ...args: any[]
) => BaseFlow

export class FlowFactory {
  /** Factory for creating different types of flows with support for multiple agents */

  static createFlow(
    flowType: FlowType,
    agents: BaseAgent | BaseAgent[] | { [key: string]: BaseAgent },
    ...kwargs: any[]
  ): BaseFlow {
    const flows: { [key in FlowType]: FlowConstructor } = {
      [FlowType.PLANNING]: PlanningFlow,
    }

    const FlowClass = flows[flowType]
    if (!FlowClass) {
      throw new Error(`Unknown flow type: ${flowType}`)
    }

    return new FlowClass(agents, ...kwargs)
  }
}

import { BaseAgent } from './base'

export abstract class ReactAgent extends BaseAgent {
  /**
   * Process current state and decide next action
   */
  abstract think(): Promise<boolean>
  /**
   * Execute decided actions
   */
  abstract act(): Promise<string>
  async step(): Promise<string> {
    const shouldContinue = await this.think()
    if (!shouldContinue) {
      return 'Thinking complete - no action needed'
    }
    const res = await this.act()
    return res
  }
}

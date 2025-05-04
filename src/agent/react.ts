import { BaseAgent } from './base'

export abstract class ReactAgent extends BaseAgent {
  /**
   * Process current state and decide next action
   */
  abstract think(model?: string): Promise<boolean>
  /**
   * Execute decided actions
   */
  abstract act(model?: string): Promise<string>
  async step(model?: string): Promise<string> {
    const shouldContinue = await this.think(model)
    if (!shouldContinue) {
      return 'Thinking complete - no action needed'
    }
    const res = await this.act(model)
    return res
  }
}

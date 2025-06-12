import type { BaseTool, ToolResult } from './base'
import { ChatCompletionTool } from 'openai/resources/index'
import { ToolError } from '../exceptions'
/**
 * Collection classes for managing multiple tools.
 */
import { logger } from '../logger'
import { ToolFailure } from './base'

/**
 * A collection of defined tools.
 */
export class ToolCollection {
  readonly tools: BaseTool[]
  readonly toolMap: Map<string, BaseTool>

  constructor(...tools: BaseTool[]) {
    this.tools = tools
    this.toolMap = new Map(tools.map(tool => [tool.name, tool]))
  }

  /**
   * Iterator implementation
   */
  * [Symbol.iterator](): Iterator<BaseTool> {
    yield* this.tools
  }

  /**
   * Convert all tools to parameter format
   */
  toParams(): ChatCompletionTool[] {
    return this.tools.map(tool => tool.toParam())
  }

  /**
   * Execute a specific tool by name with optional input parameters
   */
  async execute(params: {
    name: string
    toolInput?: Record<string, any>
  }): Promise<ToolResult> {
    const { name, toolInput } = params
    const tool = this.toolMap.get(name)

    if (!tool) {
      return new ToolFailure(`Tool ${name} is invalid`)
    }

    try {
      return await tool.execute(toolInput)
    }
    catch (error: any) {
      return new ToolFailure(error.message)
    }
  }

  /**
   * Execute all tools in the collection sequentially
   */
  async executeAll(): Promise<ToolResult[]> {
    const results: ToolResult[] = []

    for (const tool of this.tools) {
      try {
        const result = await tool.execute()
        results.push(result)
      }
      catch (error: any) {
        results.push(new ToolFailure(error.message))
      }
    }

    return results
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): BaseTool | undefined {
    return this.toolMap.get(name)
  }

  /**
   * Add a single tool to the collection.
   * If a tool with the same name already exists, it will be skipped and a warning will be logged.
   */
  addTool(tool: BaseTool): this {
    if (this.toolMap.has(tool.name)) {
      logger.warn(`Tool ${tool.name} already exists in collection, skipping`)
      return this
    }

    this.tools.push(tool)
    this.toolMap.set(tool.name, tool)
    return this
  }

  /**
   * Add multiple tools to the collection.
   * If any tool has a name conflict with an existing tool, it will be skipped and a warning will be logged.
   */
  addTools(...tools: BaseTool[]): this {
    tools.forEach(tool => this.addTool(tool))
    return this
  }
}

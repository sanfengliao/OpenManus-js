/**
 * Tool parameter definition
 */

export interface ToolParameters {
  type: 'function'
  function: {
    name: string
    description: string
    parameters?: Record<string, any>
  }
}

/**
 * Base result interface for tool execution
 */
export interface IToolResult {
  output?: any
  error?: string
  base64Image?: string
  system?: string
}

export interface IBaseTool {
  readonly name: string
  readonly description: string
  readonly parameters?: Record<string, any>

}

/**
 * Base class for all tools
 */
export abstract class BaseTool implements IBaseTool {
  name!: string
  description!: string
  parameters?: Record<string, any> | undefined
  /**
   * Execute the tool with given parameters
   */
  async call(params: any = {}): Promise<any> {
    return this.execute(params)
  }

  /**
   * Execute the tool with given parameters - to be implemented by subclasses
   */
  abstract execute(params?: any): Promise<any>

  /**
   * Convert tool to function call format
   */
  toParam(): ToolParameters {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    }
  }
}

/**
 * Represents the result of a tool execution
 */
export class ToolResult implements IToolResult {
  constructor(
    public output?: any,
    public error?: string,
    public base64Image?: string,
    public system?: string,
  ) {}

  /**
   * Check if the result has any value
   */
  hasValue(): boolean {
    return !!(this.output || this.error || this.base64Image || this.system)
  }

  /**
   * Combine two tool results
   */
  add(other: ToolResult): ToolResult {
    const combineFields = (
      field?: string,
      otherField?: string,
      concatenate: boolean = true,
    ): string | undefined => {
      if (field && otherField) {
        if (concatenate) {
          return field + otherField
        }
        throw new Error('Cannot combine tool results')
      }
      return field || otherField
    }

    return new ToolResult(
      this.output ? this.output + (other.output || '') : other.output,
      combineFields(this.error, other.error),
      combineFields(this.base64Image, other.base64Image, false),
      combineFields(this.system, other.system),
    )
  }

  /**
   * Convert result to string
   */
  toString(): string {
    return this.error ? `Error: ${this.error}` : String(this.output)
  }

  /**
   * Returns a new ToolResult with the given fields replaced
   */
  replace(updates: Partial<IToolResult>): ToolResult {
    return new ToolResult(
      updates.output ?? this.output,
      updates.error ?? this.error,
      updates.base64Image ?? this.base64Image,
      updates.system ?? this.system,
    )
  }
}

/**
 * A ToolResult that can be rendered as a CLI output
 */
export class CLIResult extends ToolResult {
  // 可以添加CLI特定的方法
}

/**
 * A ToolResult that represents a failure
 */
export class ToolFailure extends ToolResult {
  constructor(error: string) {
    super(undefined, error)
  }
}

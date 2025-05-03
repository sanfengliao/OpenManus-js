export abstract class BaseTool {
  name: string
  description: string
  parameters: Record<string, any>
  constructor({ name, description, parameters }: { name: string, description: string, parameters: Record<string, any> }) {
    this.name = name
    this.description = description
    this.parameters = parameters
  }

  /**
   *
   */
  abstract execute(params: any): Promise<any>
}

export class ToolResult {
  output: any
  error?: string
  system?: string
  constructor(output: any, error?: string, system?: string) {
    this.output = output
    this.error = error
    this.system = system
  }
}

import { logger } from '../logger'
import { NEXT_STEP_PROMPT, SYSTEM_PROMPT } from '../prompt/manus'
import { AskHuman } from '../tool/ask-human'
import { Bash } from '../tool/bash'
import { NodeExecute } from '../tool/node-execute'
import { StrReplaceEditor } from '../tool/str-replace-editor'
import { Terminate } from '../tool/terminal'
import { ToolCollection } from '../tool/tool-collection'
import { ToolCallAgent } from './toolcall'

export interface ManusConfig {
  availableTools?: ToolCollection
  maxObserve?: number
  maxSteps?: number
  workspaceRoot?: string
}

/**
 * A versatile general-purpose agent with support for both local and MCP tools
 */
export class Manus extends ToolCallAgent {
  private initialized: boolean = false

  constructor(config: ManusConfig = {}) {
    super({
      name: 'Manus',
      systemPrompt: SYSTEM_PROMPT(config.workspaceRoot || process.cwd()),
      nextStepPrompt: NEXT_STEP_PROMPT,
      maxSteps: config.maxSteps,
      maxObserve: config.maxObserve,
      availableTools: config.availableTools || new ToolCollection(
        new NodeExecute(),
        new StrReplaceEditor(),
        new AskHuman(),
        new Bash(),
        new Terminate(),
      ),
      specialToolNames: [new Terminate().name],
    })
  }

  /**
   * Factory method to create and properly initialize a Manus instance
   */
  public static async create(config?: ManusConfig): Promise<Manus> {
    const instance = new Manus(config)
    await instance.initializeMcpServers()
    instance.initialized = true
    return instance
  }

  /**
   * Initialize connections to configured MCP servers
   */
  private async initializeMcpServers(): Promise<void> {
    // for (const [serverId, serverConfig] of Object.entries(config.mcpConfig.servers)) {
    //   try {
    //     if (serverConfig.type === 'sse') {
    //       if (serverConfig.url) {
    //         await this.connectMcpServer(serverConfig.url, serverId)
    //         logger.info(
    //           `Connected to MCP server ${serverId} at ${serverConfig.url}`,
    //         )
    //       }
    //     }
    //     else if (serverConfig.type === 'stdio') {
    //       if (serverConfig.command) {
    //         await this.connectMcpServer(
    //           serverConfig.command,
    //           serverId,
    //           true,
    //           serverConfig.args,
    //         )
    //         logger.info(
    //           `Connected to MCP server ${serverId} using command ${serverConfig.command}`,
    //         )
    //       }
    //     }
    //   }
    //   catch (error) {
    //     logger.error(
    //       `Failed to connect to MCP server ${serverId}: ${error}`,
    //     )
    //   }
    // }
  }

  /**
   * Connect to an MCP server and add its tools
   */
  public async connectMcpServer(
    serverUrl: string,
        serverId: string = '',
        useStdio: boolean = false,
        stdioArgs: string[] = [],
  ): Promise<void> {
    // if (useStdio) {
    //   await this.mcpClients.connectStdio(
    //     serverUrl,
    //     stdioArgs,
    //     serverId,
    //   )
    //   this.connectedServers[serverId || serverUrl] = serverUrl
    // }
    // else {
    //   await this.mcpClients.connectSse(serverUrl, serverId)
    //   this.connectedServers[serverId || serverUrl] = serverUrl
    // }

    // // Update available tools with only the new tools from this server
    // const newTools = this.mcpClients.tools.filter(
    //   tool => tool.serverId === serverId,
    // )
    // this.availableTools.addTools(...newTools)
  }

  /**
   * Disconnect from an MCP server and remove its tools
   */
  public async disconnectMcpServer(serverId: string = ''): Promise<void> {
    // await this.mcpClients.disconnect(serverId)
    // if (serverId) {
    //   delete this.connectedServers[serverId]
    // }
    // else {
    //   this.connectedServers = {}
    // }

    // // Rebuild available tools without the disconnected server's tools
    // const baseTools = this.availableTools.tools.filter(
    //   tool => !(tool instanceof MCPClientTool),
    // )
    // this.availableTools = new ToolCollection(baseTools)
    // this.availableTools.addTools(...this.mcpClients.tools)
  }

  /**
   * Clean up Manus agent resources
   */
  public async cleanup(): Promise<void> {
    // Disconnect from all MCP servers only if we were initialized
    if (this.initialized) {
      await this.disconnectMcpServer()
      this.initialized = false
    }
  }

  /**
   * Process current state and decide next actions with appropriate context
   */
  public async think(model?: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initializeMcpServers()
      this.initialized = true
    }

    const originalPrompt = this.nextStepPrompt
    const recentMessages = this.memory.messages.slice(-3)

    const result = await super.think(model)

    // Restore original prompt
    this.nextStepPrompt = originalPrompt

    return result
  }
}

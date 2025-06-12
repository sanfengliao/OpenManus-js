import { TextContent } from '@modelcontextprotocol/sdk//types'
import { Client } from '@modelcontextprotocol/sdk/client/index'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio'

import { logger } from '../logger'
import { BaseTool, ToolResult } from './base'
import { ToolCollection } from './tool-collection'

export class MCPClientTool extends BaseTool {
  client?: Client
  serverId: string
  originalName: string
  constructor(options: {
    client: Client
    originalName?: string
    serverId?: string
  }) {
    super()
    this.client = options.client
    this.originalName = options.originalName || ''
    this.serverId = options.serverId || ''
  }

  /**
   * Execute the tool by making a remote call to the MCP server.
   * @param params
   */
  async execute(params: any = {}): Promise<ToolResult> {
    if (!this.client) {
      return new ToolResult({
        error: 'Not connected to MCP server',
      })
    }

    try {
      logger.info(`Executing tool: ${this.originalName}`)
      const result = await this.client.callTool({
        name: this.originalName,
        ...params,
      })
      const contentStr = (result.content as any).map((item: TextContent) => {
        if (item.type === 'text') {
          return item.text
        }
        return ''
      }).filter(Boolean).jin(',')
      return new ToolResult({
        output: contentStr || 'No output returned.',
      })
    } catch (e: any) {
      return new ToolResult({
        error: `Error executing tool: ${e.message}`,
      })
    }
  }
}

export class MCPClients extends ToolCollection {
  clients: Record<string, Client> = {}
  description = 'MCP client tools for server interaction'
  name = 'mcp'

  toolMap: Map<string, MCPClientTool> = new Map()
  tools: MCPClientTool[] = []

  /**
   * Connect to an MCP server using SSE transport
   * @param serverUrl
   * @param serverId
   */
  async connectSse(serverUrl: string, serverId: string = ''): Promise<void> {
    if (!serverUrl) {
      throw new Error('Server URL is required for SSE connection')
    }

    serverId = serverId || serverUrl
    if (this.clients[serverId]) {
      await this.disconnect(serverId)
    }
    const session = new Client({
      name: serverId,
      version: '1.0',
    })

    await session.connect(
      new SSEClientTransport(new URL(serverUrl)),
    )
    this.clients[serverId] = session
    await this.initializeAndListTools(serverId)
  }

  /**
   * Connect to an MCP server using stdio transport.
   * @param command
   * @param args
   * @param serverId
   */
  async connectStdio(command: string, args: string[], serverId = '') {
    if (!command) {
      throw new Error('Command is required for stdio connection')
    }

    serverId = serverId || command
    if (this.clients[serverId]) {
      await this.disconnect(serverId)
    }
    const session = new Client({
      name: serverId,
      version: '1.0',
    })

    await session.connect(
      new StdioClientTransport({
        command,
        args,
      }),
    )
    this.clients[serverId] = session
    await this.initializeAndListTools(serverId)
  }

  /**
   * Initialize session and populate tool map
   * @param serverId
   */
  async initializeAndListTools(serverId: string) {
    const client = this.clients[serverId]
    if (!client) {
      throw new Error(`Client not found for server ID: ${serverId}`)
    }
    const response = await client.listTools()
    for (const tool of response.tools) {
      const originName = tool.name
      const toolName = this.sanitizeToolName(`mcp_${serverId}_${originName}`)
      const serverTool = new MCPClientTool({
        originalName: originName,
        client,
        serverId,
      })
      serverTool.parameters = tool.parameters || {}
      serverTool.name = toolName
      serverTool.description = tool.description || `Tool from MCP server ${serverId}`
      this.toolMap.set(toolName, serverTool)
    }
    this.tools = Array.from(this.toolMap.values())
    logger.info(`Connected to server ${serverId} with tools: ${response.tools.map(t => t.name).join(', ')}`)
  }

  /**
   * List all available tools.
   */
  async listTools() {
    const tools = []
    for (const client of Object.values(this.clients)) {
      const response = await client.listTools()
      tools.push(...response.tools)
    }
    return tools
  }

  /**
   * Sanitize tool name to match MCPClientTool requirements.
   */
  private sanitizeToolName(name: string): string {
    // Replace invalid characters with underscores
    let sanitized = name.replace(/[^\w-]/g, '_')

    // Remove consecutive underscores
    sanitized = sanitized.replace(/_+/g, '_')

    // Remove leading/trailing underscores
    sanitized = sanitized.replace(/^_+|_+$/g, '')

    // Truncate to 64 characters if needed
    if (sanitized.length > 64) {
      sanitized = sanitized.substring(0, 64)
    }

    return sanitized
  }

  async disconnect(serverId: string) {
    if (serverId) {
      const client = this.clients[serverId]
      if (client) {
        await client.close()
      }

      const names = this.toolMap.keys().filter(name => this.toolMap.get(name)?.serverId === serverId)

      names.forEach((name) => {
        this.toolMap.delete(name)
      })
      this.tools = Array.from(this.toolMap.values())
    } else {
      this.toolMap.forEach((tool, name) => {
        this.disconnect(tool.serverId)
      })
      this.toolMap.clear()
    }
  }
}

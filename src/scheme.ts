/**
 * 消息角色选项
 */

import type { ChatCompletionMessageParam, ChatCompletionToolMessageParam } from 'openai/resources/index'

export enum Role {
  SYSTEM = 'system',
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
}

/**
 * 工具选择选项
 */
export enum ToolChoice {
  NONE = 'none',
  AUTO = 'auto',
  REQUIRED = 'required',
}

/**
 * 代理执行状态
 */
export enum AgentState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  FINISHED = 'FINISHED',
  ERROR = 'ERROR',
}

/**
 * 函数调用的参数结构
 */
export interface Function {
  name: string
  arguments: string | Record<string, any>
}

/**
 * 工具调用的结构
 */
export interface ToolCall {
  id: string
  type: 'function'
  function: Function
}

/**
 * 消息的基本结构
 */
export interface IMessage {
  role: Role
  content?: string | null
  tool_calls?: ToolCall[] | null
  name?: string | null
  tool_call_id?: string | null
  base64_image?: string | null
}

/**
 * 内存管理的接口
 */
export interface Memory {
  messages: Message[]
  max_messages: number
  addMessage: (message: Message) => void
  addMessages: (messages: Message[]) => void
  clear: () => void
  getRecentMessages: (n: number) => Message[]
  toDictList: () => Record<string, any>[]
}

export class Message implements IMessage {
  constructor(
    public role: Role,
    public content?: string | null,
    public tool_calls?: ToolCall[] | null,
    public name?: string | null,
    public tool_call_id?: string | null,
    public base64_image?: string | null,
  ) { }

  /**
   * 将消息转换为字典格式
   */
  static toChatCompletionMessage(message: IMessage): ChatCompletionMessageParam {
    const chatMessage = { role: message.role } as ChatCompletionMessageParam

    if (message.content !== null && message.content !== undefined) {
      chatMessage.content = message.content
    }
    // if (message.tool_calls) {
    //   (chatMessage as any).tool_calls = message.tool_calls.map(call => ({
    //     id: call.id,
    //     type: call.type,
    //     function: call.function,
    //   }))
    // }
    if (message.name) {
      (chatMessage as any).name = message.name
    }
    if (message.tool_call_id) {
      (chatMessage as ChatCompletionToolMessageParam).tool_call_id = message.tool_call_id
    }
    if (message.base64_image) {
      (chatMessage as any).base64_image = message.base64_image
    }

    return chatMessage
  }

  /**
   * 创建用户消息
   */
  static userMessage(content: string, base64_image?: string): Message {
    return new Message(Role.USER, content, null, null, null, base64_image)
  }

  /**
   * 创建系统消息
   */
  static systemMessage(content: string): Message {
    return new Message(Role.SYSTEM, content)
  }

  /**
   * 创建助手消息
   */
  static assistantMessage(content?: string, base64_image?: string): Message {
    return new Message(Role.ASSISTANT, content, null, null, null, base64_image)
  }

  /**
   * 创建工具消息
   */
  static toolMessage(params: {
    content: string
    name?: string
    tool_call_id: string
    base64_image?: string
  }): Message {
    return new Message(
      Role.TOOL,
      params.content,
      null,
      params.name,
      params.tool_call_id,
      params.base64_image,
    )
  }

  /**
   * 从工具调用创建消息
   */
  static fromToolCalls(
    tool_calls: any[],
    content: string | string[] = '',
    base64_image?: string,
    kwargs: Record<string, any> = {},
  ): Message {
    const formatted_calls = tool_calls.map(call => ({
      id: call.id,
      function: {
        ...call.function,
        arguments: call.function.arguments,
      },
      type: 'function' as const,
    }))

    return new Message(
      Role.ASSISTANT,
      Array.isArray(content) ? content.join('\n') : content,
      formatted_calls,
      kwargs.name,
      kwargs.tool_call_id,
      base64_image,
    )
  }
}

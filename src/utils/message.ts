import type { ChatCompletionAssistantMessageParam, ChatCompletionMessageToolCall, ChatCompletionSystemMessageParam, ChatCompletionToolMessageParam, ChatCompletionUserMessageParam } from 'openai/resources/index'

export const MessageUtils = {
  /**
   * Create a user message
   * @param content 
   * @returns 
   */
  userMessage(content: string): ChatCompletionUserMessageParam {
    return {
      role: 'user',
      content,
    }
  },

  /**
   * Create an assistant message
   * @param content 
   * @returns 
   */
  assistantMessage(content: string): ChatCompletionAssistantMessageParam {
    return {
      role: 'assistant',
      content,
    }
  },

  /**
   * Create a system message
   * @param content 
   * @returns 
   */
  systemMessage(content: string): ChatCompletionSystemMessageParam {
    return {
      role: 'system',
      content,
    }
  },

  /**
   * Create a tool message
   * @param content 
   * @param toolCallId 
   * @returns 
   */
  toolMessage(content: string, toolCallId: string): ChatCompletionToolMessageParam{
    return {
      content,
      tool_call_id: toolCallId,
      role: 'tool',
    }
  },

  /**
   * Create ToolCallsMessage from raw tool calls.
   * @param toolCalls  Raw tool calls from LLM
   * @param content Optional message content
   * @returns 
   */
  fromToolCalls(toolCalls: ChatCompletionMessageToolCall[], content?: string): ChatCompletionAssistantMessageParam {
    return {
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    }
  }
}

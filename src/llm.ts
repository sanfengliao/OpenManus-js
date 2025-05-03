import type { ChatCompletionMessageParam, ChatCompletionSystemMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat'
import type { IMessage } from './scheme'

import type { LLMConfig } from './type'
import OpenAI, { AzureOpenAI } from 'openai'
import { Message } from './scheme'
import { logger } from './logger'

export interface AskParams {
  /**
   * List of conversation messages
   */
  messages: ChatCompletionMessageParam[]
  /**
   * Optional system messages to prepend
   */
  systemMessages?: ChatCompletionSystemMessageParam[]
  /**
   * Whether to stream the response
   */
  stream?: boolean
  /**
   * Sampling temperature for the response
   */
  temperature?: number
  model?: string

}

export interface AskToolParams {
  /**
   * List of conversation messages
   */
  messages: IMessage[]
  /**
   * Optional system messages to prepend
   */
  systemMsgs?: IMessage[]
  /**
   * Request timeout in seconds
   */
  timeout?: number
  /**
   *  List of tools to use
   */
  tools?: ChatCompletionTool[]

  // Tool choice strategy
  toolChoice?: ChatCompletionToolChoiceOption
  //  Sampling temperature for the response
  temperature?: number

  model?: string
}

export class LLM {
  client: OpenAI
  model?: string
  temperature: number
  constructor(config: LLMConfig = {}) {
    const { model, temperature = 0, apiKey, apiType = 'Openai', baseURL } = config
    this.model = model
    this.temperature = temperature
    // TODO 支持多种api
    this.client = new OpenAI({
      baseURL,
      apiKey,
    })
  }

  /**
   *  Send a prompt to the LLM and get the response.
   * @param messages
   * @param systemMessages
   * @param stream
   * @param model
   * @returns
   */
  async ask({
    messages,
    systemMessages,
    stream = true,
    model,
    temperature,
  }: {
    messages: IMessage[]
    systemMessages?: IMessage[]
    stream?: boolean
    temperature?: number
    model?: string
  }) {
    try {
      model = model || this.model

      if (!model) {
        throw new Error('Model is not set')
      }
      if (systemMessages) {
        messages = [
          ...systemMessages,
          ...messages,
        ]
      }

      if (!stream) {
        const res = await this.client.chat.completions.create({
          model,
          messages: messages.map(Message.toChatCompletionMessage),
          temperature: temperature || this.temperature,
          stream: false,
        })

        if (!res.choices || !res.choices[0]?.message.content) {
          throw new Error('Empty or invalid response from LLM')
        }

        return res.choices[0].message.content
      }

      const res = await this.client.chat.completions.create({
        model,
        messages: messages.map(Message.toChatCompletionMessage),
        temperature: temperature || this.temperature,
        stream: true,
      })

      const collectMessages: string[] = []

      let completionText = ''

      for await (const event of res) {
        const chunkMessage = event.choices[0].delta.content
        if (!chunkMessage) {
          continue
        }
        collectMessages.push(chunkMessage)
        completionText += chunkMessage
        console.log(chunkMessage)
      }

      const fullResponse = collectMessages.join('')
      if (!fullResponse) {
        throw new Error('Empty response from streaming LLM')
      }
      return fullResponse
    }
    catch (error) {
      // TODO format error
      console.log(error)
    }
  }

  async askWithImages() {
    // TODO implement
  }

  async askTool({
    toolChoice,
    tools,
    messages,
    model,
    temperature,
    systemMsgs,
  }: AskToolParams) {
    model = model || this.model
    if (!model) {
      throw new Error('Model is not set')
    }
    if (systemMsgs) {
      messages = [
        ...systemMsgs,
        ...messages,
      ]
    }

    const response = await this.client.chat.completions.create({
      tools,
      messages: messages.map(Message.toChatCompletionMessage),
      model,
      temperature: temperature || this.temperature,
      tool_choice: toolChoice,
      stream: false,
    })

    // Check if response is valid
    if (!response.choices || !response.choices[0]?.message) {
      console.log(response)

      return undefined
    }

    return response.choices[0].message
  }
}

import type { ChatCompletionContentPart, ChatCompletionContentPartImage, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming, ChatCompletionMessageParam, ChatCompletionSystemMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption, ChatCompletionToolMessageParam } from 'openai/resources/chat'
import type { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions'

import type { Tiktoken } from 'tiktoken'
import type { LLMSettings } from './config'
import type { ContentItem, ImageItem, IMessage, ToolCall } from './scheme'
import OpenAI, { AzureOpenAI } from 'openai'

import * as tiktoken from 'tiktoken'
import { config } from './config'

// import { retry } from '../utils/retry';
import { TokenLimitExceeded } from './exceptions'
import { logger } from './logger'
import { Message, ToolChoice } from './scheme'

// 新增的接口定义
export interface AskParams {
  messages: IMessage[]
  systemMsgs?: IMessage[]
  stream?: boolean
  temperature?: number
  model?: string
}

export interface AskWithImagesParams {
  messages: IMessage[]
  images: (string | ImageItem)[]
  systemMsgs?: Message[]
  stream?: boolean
  temperature?: number
  model?: string
}

export interface AskToolParams {
  messages: IMessage[]
  systemMsgs?: IMessage[]
  tools?: any[]
  toolChoice?: ToolChoice
  temperature?: number
  extraParams?: Record<string, any>
  model?: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export class TokenCounter {
  // Token constants
  private static readonly BASE_MESSAGE_TOKENS = 4
  private static readonly FORMAT_TOKENS = 2
  private static readonly LOW_DETAIL_IMAGE_TOKENS = 85
  private static readonly HIGH_DETAIL_TILE_TOKENS = 170

  // Image processing constants
  private static readonly MAX_SIZE = 2048
  private static readonly HIGH_DETAIL_TARGET_SHORT_SIDE = 768
  private static readonly TILE_SIZE = 512

  constructor(private tokenizer: Tiktoken) { }

  public countText(text: string): number {
    if (!text)
      return 0
    return this.tokenizer.encode(text).length
  }

  public countImage(imageItem: ImageItem): number {
    const detail = imageItem.image_url.detail || 'medium'

    if (detail === 'low') {
      return TokenCounter.LOW_DETAIL_IMAGE_TOKENS
    }

    if (detail === 'high' || detail === 'medium') {
      if (imageItem.image_url.dimensions) {
        const [width, height] = imageItem.image_url.dimensions
        return this.calculateHighDetailTokens(width, height)
      }
    }

    return detail === 'high'
      ? this.calculateHighDetailTokens(1024, 1024)
      : 1024
  }

  private calculateHighDetailTokens(width: number, height: number): number {
    // Scale to fit in MAX_SIZE x MAX_SIZE square
    if (width > TokenCounter.MAX_SIZE || height > TokenCounter.MAX_SIZE) {
      const scale = TokenCounter.MAX_SIZE / Math.max(width, height)
      width = Math.floor(width * scale)
      height = Math.floor(height * scale)
    }

    // Scale shortest side to HIGH_DETAIL_TARGET_SHORT_SIDE
    const scale = TokenCounter.HIGH_DETAIL_TARGET_SHORT_SIDE / Math.min(width, height)
    const scaledWidth = Math.floor(width * scale)
    const scaledHeight = Math.floor(height * scale)

    // Count 512px tiles
    const tilesX = Math.ceil(scaledWidth / TokenCounter.TILE_SIZE)
    const tilesY = Math.ceil(scaledHeight / TokenCounter.TILE_SIZE)
    const totalTiles = tilesX * tilesY

    return (totalTiles * TokenCounter.HIGH_DETAIL_TILE_TOKENS)
      + TokenCounter.LOW_DETAIL_IMAGE_TOKENS
  }

  public countContent(content: ContentItem): number {
    if (!content)
      return 0

    if (typeof content === 'string') {
      return this.countText(content)
    }

    return content.reduce((total, item) => {
      if (typeof item === 'string') {
        return total + this.countText(item)
      }
      if (item.type === 'text') {
        return total + this.countText(item.text)
      }
      if (item.type === 'image_url') {
        return total + this.countImage(item)
      }
      return total
    }, 0)
  }

  public countToolCalls(toolCalls: ToolCall[]): number {
    return toolCalls.reduce((total, toolCall) => {
      if ('function' in toolCall) {
        const { function: fn } = toolCall
        return total
          + this.countText(fn.name || '')
          + this.countText(JSON.stringify(fn.arguments || ''))
      }
      return total
    }, 0)
  }

  public countMessageTokens(messages: (IMessage)[]): number {
    return messages.reduce((total, message) => {
      let tokens = TokenCounter.BASE_MESSAGE_TOKENS

      // Add role tokens
      tokens += this.countText(message.role)

      // Add content tokens
      if ('content' in message && message.content) {
        tokens += this.countContent(message.content)
      }

      // Add tool calls tokens
      if (message.tool_calls) {
        tokens += this.countToolCalls(message.tool_calls)
      }

      // Add name and tool_call_id tokens
      tokens += this.countText(message.name || '')
      tokens += this.countText(message.tool_call_id || '')

      return total + tokens
    }, TokenCounter.FORMAT_TOKENS)
  }
}

// 定义常量
const REASONING_MODELS = ['o1', 'o3-mini']
const MULTIMODAL_MODELS = [
  'gpt-4-vision-preview',
  'gpt-4o',
  'gpt-4o-mini',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
]
const TOOL_CALL_PARAM_REQUIRED_MODELS = [
  'gpt-4-vision-preview',
  'gpt-4o',
  'gpt-4o-mini',
]

export class LLM {
  private static instances: Map<string, LLM> = new Map()
  private client!: OpenAI
  private tokenCounter!: TokenCounter
  private tokenizer!: Tiktoken
  private model: string
  private maxTokens: number
  private temperature: number
  private apiType: string
  private apiKey: string
  private apiVersion: string
  private baseUrl: string
  private totalInputTokens: number = 0
  private totalCompletionTokens: number = 0
  private maxInputTokens?: number

  constructor(
    configName: string = 'default',
    llmConfig?: LLMSettings,
  ) {
    const settings = llmConfig || config.llm[configName] || config.llm.default

    this.model = settings.model
    this.maxTokens = settings.maxTokens
    this.temperature = settings.temperature
    this.apiType = settings.apiType
    this.apiKey = settings.apiKey
    this.apiVersion = settings.apiVersion
    this.baseUrl = settings.baseUrl
    this.maxInputTokens = settings.maxInputTokens

    this.initializeClient()
    this.initializeTokenizer()
  }

  public static getInstance(
    configName: string = 'default',
    llmConfig?: LLMSettings,
  ): LLM {
    if (!this.instances.has(configName)) {
      this.instances.set(
        configName,
        new LLM(configName, llmConfig),
      )
    }
    return this.instances.get(configName)!
  }

  private initializeClient(): void {
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    })
    // if (this.apiType === 'azure') {
    //   this.client = new OpenAI({
    //     apiKey: this.apiKey,
    //     baseURL: this.baseUrl,
    //     defaultHeaders: {
    //       'api-key': this.apiKey,
    //       'api-version': this.apiVersion
    //     }
    //   });
    // } else if (this.apiType === 'aws') {
    //   this.client = new BedrockClient();
    // } else {
    //   this.client = new OpenAI({
    //     apiKey: this.apiKey,
    //     baseURL: this.baseUrl
    //   });
    // }
  }

  private initializeTokenizer(): void {
    try {
      this.tokenizer = tiktoken.encoding_for_model(this.model as any)
    }
    catch (error) {
      // 如果模型不支持，使用默认分词器
      this.tokenizer = tiktoken.get_encoding('cl100k_base')
    }
    this.tokenCounter = new TokenCounter(this.tokenizer)
  }

  private countTokens(text: string): number {
    return text ? this.tokenCounter.countText(text) : 0
  }

  private countMessageTokens(messages: IMessage[]): number {
    return this.tokenCounter.countMessageTokens(messages)
  }

  private updateTokenCount(
    inputTokens: number,
    completionTokens: number = 0,
  ): void {
    this.totalInputTokens += inputTokens
    this.totalCompletionTokens += completionTokens

    logger.info(
      'Token usage:',
      `Input=${inputTokens}`,
      `Completion=${completionTokens}`,
      `Cumulative Input=${this.totalInputTokens}`,
      `Cumulative Completion=${this.totalCompletionTokens}`,
      `Total=${inputTokens + completionTokens}`,
      `Cumulative Total=${this.totalInputTokens + this.totalCompletionTokens}`,
    )
  }

  private checkTokenLimit(inputTokens: number): boolean {
    if (this.maxInputTokens) {
      return (this.totalInputTokens + inputTokens) <= this.maxInputTokens
    }
    return true
  }

  private getLimitErrorMessage(inputTokens: number): string {
    if (this.maxInputTokens
      && (this.totalInputTokens + inputTokens) > this.maxInputTokens
    ) {
      return `Request may exceed input token limit (Current: ${this.totalInputTokens}, Needed: ${inputTokens}, Max: ${this.maxInputTokens})`
    }
    return 'Token limit exceeded'
  }

  /**
   * Format messages for LLM by converting them to OpenAI message format.
   *
   * @param messages - List of messages that can be either dict or Message objects
   * @param supportsImages - Flag indicating if the target model supports image inputs
   * @returns List of formatted messages in OpenAI format
   * @throws {Error} If messages are invalid or missing required fields
   *
   * @example
   * ```typescript
   * const msgs = [
   *     Message.systemMessage("You are a helpful assistant"),
   *     { role: "user", content: "Hello" },
   *     Message.userMessage("How are you?")
   * ];
   * const formatted = LLM.formatMessages(msgs);
   * ```
   */
  public static formatMessages(
    messages: Array<IMessage | Message>,
    supportsImages: boolean = false,
    isToolCallParamRequired: boolean = true,
  ): ChatCompletionMessageParam[] {
    const formattedMessages: ChatCompletionMessageParam[] = []

    for (const message of messages) {
      // Convert Message objects to dictionaries
      const messageDict = message instanceof Message
        ? Message.toChatCompletionMessage(message)
        : message

      // If message is a dict, ensure it has required fields
      if (!messageDict.role) {
        throw new Error('Message dict must contain \'role\' field')
      }

      // Process base64 images if present and model supports images
      if (supportsImages && messageDict.base64_image) {
        let content = messageDict.content

        // Initialize or convert content to appropriate format
        if (!content) {
          content = []
        }
        else if (typeof content === 'string') {
          content = [{
            type: 'text' as const,
            text: content,
          }]
        }
        else if (Array.isArray(content)) {
          // Convert string items to proper text objects
          content = content.map(item =>
            typeof item === 'string'
              ? { type: 'text' as const, text: item }
              : item,
          )
        }

        // Add the image to content
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${messageDict.base64_image}`,
          },
        })

        messageDict.content = content
        delete messageDict.base64_image
      }
      // If model doesn't support images but message has base64_image, handle gracefully
      else if (!supportsImages && messageDict.base64_image) {
        // Just remove the base64_image field and keep the text content
        delete messageDict.base64_image
      }

      // Only include messages with content or tool_calls
      if ('content' in messageDict || 'tool_calls' in messageDict) {
        // When the role is "tool", some models require tool_calls to be present（gpt-4o),
        // while others require it to be absent(deepseek). This handles that model-specific requirement.
        if (!isToolCallParamRequired && messageDict.tool_calls) {
          delete messageDict.tool_calls
        }
        formattedMessages.push(messageDict as ChatCompletionMessageParam)
      }
    }

    // Validate all messages have required fields
    const ROLE_VALUES = ['system', 'user', 'assistant', 'tool']
    for (const msg of formattedMessages) {
      if (!ROLE_VALUES.includes(msg.role)) {
        throw new Error(`Invalid role: ${msg.role}`)
      }
    }

    return formattedMessages
  }

  //   @retry({
  //     attempts: 6,
  //     delay: { min: 1000, max: 60000 },
  //     errorTypes: [Error]
  // })
  public async ask(params: AskParams): Promise<string> {
    try {
      const { messages, systemMsgs, stream = true, temperature, model } = params
      const supportsImages = MULTIMODAL_MODELS.includes(this.model)
      const isToolCallsParamRequired = TOOL_CALL_PARAM_REQUIRED_MODELS.includes(this.model)
      let allMessages: ChatCompletionMessageParam[]

      if (systemMsgs) {
        const formattedSystemMsgs = LLM.formatMessages(
          systemMsgs,
          supportsImages,
          isToolCallsParamRequired,
        )
        const formattedMessages = LLM.formatMessages(
          messages,
          supportsImages,
          isToolCallsParamRequired,
        )
        allMessages = [...formattedSystemMsgs, ...formattedMessages]
      }
      else {
        allMessages = LLM.formatMessages(messages, supportsImages)
      }

      // 计算输入token
      const inputTokens = this.countMessageTokens(allMessages as IMessage[])
      if (!this.checkTokenLimit(inputTokens)) {
        throw new TokenLimitExceeded(
          this.getLimitErrorMessage(inputTokens),
        )
      }

      const paramsBase: ChatCompletionCreateParamsBase = {
        model: model || this.model,
        messages: allMessages,
      }

      // 添加模型特定参数
      if (REASONING_MODELS.includes(this.model)) {
        paramsBase.max_completion_tokens = this.maxTokens
      }
      else {
        paramsBase.max_tokens = this.maxTokens
        paramsBase.temperature = temperature ?? this.temperature
      }

      // 非流式请求
      if (!stream) {
        const response = await this.client.chat.completions.create({
          ...paramsBase,
          stream: false,
        })

        if (!response.choices?.[0]?.message?.content) {
          throw new Error('Empty or invalid response from LLM')
        }

        this.updateTokenCount(
          response.usage?.prompt_tokens || 0,
          response.usage?.completion_tokens,
        )

        return response.choices[0].message.content
      }

      // 流式请求
      this.updateTokenCount(inputTokens)
      const res = await this.client.chat.completions.create({
        ...paramsBase,
        stream: true,
      })

      let completionText = ''
      for await (const chunk of res) {
        const content = chunk.choices[0]?.delta?.content || ''
        completionText += content
        process.stdout.write(content)
      }
      console.log() // 换行

      if (!completionText) {
        throw new Error('Empty response from streaming LLM')
      }

      // 估算完成tokens
      const completionTokens = this.countTokens(completionText)
      this.totalCompletionTokens += completionTokens

      return completionText.trim()
    }
    catch (error) {
      if (error instanceof TokenLimitExceeded) {
        throw error
      }

      logger.error('Error in ask:', error)
      throw error
    }
  }

  // @retry({
  //   attempts: 6,
  //   delay: { min: 1000, max: 60000 },
  //   errorTypes: [Error]
  // })
  public async askWithImages(params: AskWithImagesParams): Promise<string> {
    try {
      const { messages, images, systemMsgs, stream = false, temperature, model } = params
      const isToolCallParamRequired = TOOL_CALL_PARAM_REQUIRED_MODELS.includes(this.model)

      if (!MULTIMODAL_MODELS.includes(this.model)) {
        throw new Error(
          `Model ${this.model} does not support images. `
          + `Use a model from ${MULTIMODAL_MODELS.join(', ')}`,
        )
      }

      const formattedMessages = LLM.formatMessages(messages, true, isToolCallParamRequired)

      // 确保最后一条消息是用户消息
      if (!formattedMessages.length
        || formattedMessages[formattedMessages.length - 1].role !== 'user'
      ) {
        throw new Error(
          'The last message must be from the user to attach images',
        )
      }

      // 处理最后一条消息
      const lastMessage = formattedMessages[formattedMessages.length - 1]
      const content = Array.isArray(lastMessage.content)
        ? lastMessage.content
        : [{ type: 'text', text: lastMessage.content || '' }]

      // 添加图片
      const imageContent = images.map((image) => {
        if (typeof image === 'string') {
          return {
            type: 'image_url',
            image_url: { url: image },
          }
        }
        return {
          type: 'image_url',
          image_url: image,
        }
      })

      lastMessage.content = [...content, ...imageContent] as ChatCompletionContentPart[]

      // 添加系统消息
      const allMessages = systemMsgs
        ? [...LLM.formatMessages(systemMsgs, true), ...formattedMessages]
        : formattedMessages

      // 计算和检查token
      const inputTokens = this.countMessageTokens(allMessages as IMessage[])
      if (!this.checkTokenLimit(inputTokens)) {
        throw new TokenLimitExceeded(
          this.getLimitErrorMessage(inputTokens),
        )
      }

      const paramsBase: ChatCompletionCreateParamsBase = {
        model: model || this.model,
        messages: allMessages,
      }

      // 添加模型特定参数
      if (REASONING_MODELS.includes(this.model)) {
        paramsBase.max_completion_tokens = this.maxTokens
      }
      else {
        paramsBase.max_tokens = this.maxTokens
        paramsBase.temperature = temperature ?? this.temperature
      }

      if (!stream) {
        paramsBase.stream = false
        const response = await this.client.chat.completions.create(paramsBase as ChatCompletionCreateParamsNonStreaming)

        if (!response.choices?.[0]?.message?.content) {
          throw new Error('Empty or invalid response from LLM')
        }

        this.updateTokenCount(
          response.usage?.prompt_tokens || 0,
          response.usage?.completion_tokens,
        )

        return response.choices[0].message.content
      }

      // 流式请求
      this.updateTokenCount(inputTokens)
      paramsBase.stream = true
      const res = await this.client.chat.completions.create(paramsBase as ChatCompletionCreateParamsStreaming)

      let completionText = ''
      for await (const chunk of res) {
        const content = chunk.choices[0]?.delta?.content || ''
        completionText += content
        process.stdout.write(content)
      }
      console.log()

      if (!completionText) {
        throw new Error('Empty response from streaming LLM')
      }

      return completionText.trim()
    }
    catch (error) {
      if (error instanceof TokenLimitExceeded) {
        throw error
      }

      logger.error('Error in askWithImages:', error)
      throw error
    }
  }

  // @retry({
  //   attempts: 6,
  //   delay: { min: 1000, max: 60000 },
  //   errorTypes: [Error]
  // })
  public async askTool(params: AskToolParams): Promise<any> {
    try {
      const { messages, systemMsgs, tools, toolChoice = ToolChoice.AUTO, temperature, extraParams, model } = params

      const supportsImages = MULTIMODAL_MODELS.includes(this.model)
      const isToolCallParamRequired = TOOL_CALL_PARAM_REQUIRED_MODELS.includes(this.model)
      let allMessages: ChatCompletionMessageParam[]

      if (systemMsgs) {
        const formattedSystemMsgs = LLM.formatMessages(
          systemMsgs,
          supportsImages,
          isToolCallParamRequired,
        )
        const formattedMessages = LLM.formatMessages(
          messages,
          supportsImages,
          isToolCallParamRequired,
        )
        allMessages = [...formattedSystemMsgs, ...formattedMessages]
      }
      else {
        allMessages = LLM.formatMessages(messages, supportsImages)
      }

      // 计算输入token
      let inputTokens = this.countMessageTokens(allMessages as IMessage[])

      // 计算工具描述的token
      if (tools) {
        const toolsTokens = tools.reduce(
          (sum, tool) => sum + this.countTokens(JSON.stringify(tool)),
          0,
        )
        inputTokens += toolsTokens
      }

      // 检查token限制
      if (!this.checkTokenLimit(inputTokens)) {
        throw new TokenLimitExceeded(
          this.getLimitErrorMessage(inputTokens),
        )
      }

      // 验证工具
      if (tools) {
        for (const tool of tools) {
          if (!tool || typeof tool !== 'object' || !('type' in tool)) {
            throw new Error(
              'Each tool must be a dict with type field',
            )
          }
        }
      }

      const paramsBase: ChatCompletionCreateParamsNonStreaming = {
        model: model || this.model,
        messages: allMessages,
        tools,
        tool_choice: toolChoice,
        stream: false,
        ...extraParams,
      }

      // 添加模型特定参数
      if (REASONING_MODELS.includes(this.model)) {
        paramsBase.max_completion_tokens = this.maxTokens
      }
      else {
        paramsBase.max_tokens = this.maxTokens
        paramsBase.temperature = temperature ?? this.temperature
      }

      const response = await this.client.chat.completions.create(paramsBase)

      if (!response.choices?.[0]?.message) {
        console.log(response)
        return null
      }

      this.updateTokenCount(
        response.usage?.prompt_tokens || 0,
        response.usage?.completion_tokens,
      )

      return response.choices[0].message
    }
    catch (error) {
      if (error instanceof TokenLimitExceeded) {
        throw error
      }

      logger.error('Error in askTool:', error)
      throw error
    }
  }
}

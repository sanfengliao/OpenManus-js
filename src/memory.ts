import type { ChatCompletionMessageParam } from 'openai/resources/index'

export class Memory {
  messages: ChatCompletionMessageParam[] = []
  maxMessages = 100
  /**
   * Add a message to memory
   * @param messages
   */
  addMessages(messages: ChatCompletionMessageParam[]) {
    this.messages.push(...messages)
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(this.messages.length - this.maxMessages)
    }
  }

  addMessage(message: ChatCompletionMessageParam) {
    this.messages.push(message)
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(this.messages.length - this.maxMessages)
    }
  }

  clear() {
    this.messages = []
  }

  getRecentMessages(n: number) {
    return this.messages.slice(this.messages.length - n)
  }
}

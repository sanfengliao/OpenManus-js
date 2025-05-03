import type { ChatCompletionMessageParam } from 'openai/resources/index'
import type { IMessage } from './scheme'

export class Memory {
  messages: IMessage[] = []
  maxMessages = 100
  /**
   * Add a message to memory
   * @param messages
   */
  addMessages(messages: IMessage[]) {
    this.messages.push(...messages)
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(this.messages.length - this.maxMessages)
    }
  }

  addMessage(message: IMessage) {
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

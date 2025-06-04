import type { IMessage } from '../scheme'
import TurndownService from 'turndown'
import { BrowserProfile, BrowserSession } from '../../browser-use-js/src/browser/session'
import { DomService } from '../../browser-use-js/src/dom/service'
import { ToolChoice } from '../agent/toolcall'
import { config } from '../config'
import { ToolError } from '../exceptions'
import { LLM } from '../llm'
import { BaseTool, ToolFailure, ToolResult } from './base'
import { WebSearch } from './web-search'

export const BROWSER_DESCRIPTION = `A powerful browser automation tool that allows interaction with web pages through various actions.
* This tool provides commands for controlling a browser session, navigating web pages, and extracting information
* It maintains state across calls, keeping the browser session alive until explicitly closed
* Use this when you need to browse websites, fill forms, click buttons, extract content, or perform web searches
* Each action requires specific parameters as defined in the tool's dependencies

Key capabilities include:
* Navigation: Go to specific URLs, go back, search the web, or refresh pages
* Interaction: Click elements, input text, select from dropdowns, send keyboard commands
* Scrolling: Scroll up/down by pixel amount or scroll to specific text
* Content extraction: Extract and analyze content from web pages based on specific goals
* Tab management: Switch between tabs, open new tabs, or close tabs

Note: When using element indices, refer to the numbered elements shown in the current browser state.`

// 枚举类型定义
export const BrowserAction = {
  GO_TO_URL: 'go_to_url',
  CLICK_ELEMENT: 'click_element',
  INPUT_TEXT: 'input_text',
  SCROLL_DOWN: 'scroll_down',
  SCROLL_UP: 'scroll_up',
  SCROLL_TO_TEXT: 'scroll_to_text',
  SEND_KEYS: 'send_keys',
  GET_DROPDOWN_OPTIONS: 'get_dropdown_options',
  SELECT_DROPDOWN_OPTION: 'select_dropdown_option',
  GO_BACK: 'go_back',
  WEB_SEARCH: 'web_search',
  WAIT: 'wait',
  EXTRACT_CONTENT: 'extract_content',
  SWITCH_TAB: 'switch_tab',
  OPEN_TAB: 'open_tab',
  CLOSE_TAB: 'close_tab',
  REFRESH: 'refresh',
} as const

type BrowserActionInterface = typeof BrowserAction
export type ActionValue = BrowserActionInterface[keyof BrowserActionInterface]

export interface BrowserExecuteParams {
  action: ActionValue
  url?: string
  index?: number
  text?: string
  scroll_amount?: number
  tab_id?: number
  query?: string
  goal?: string
  keys?: string
  seconds?: number
}

const BrowserActionDependencies: Record<ActionValue, string[]> = {
  go_to_url: ['url'],
  click_element: ['index'],
  input_text: ['index', 'text'],
  switch_tab: ['tab_id'],
  open_tab: ['url'],
  scroll_down: ['scroll_amount'],
  scroll_up: ['scroll_amount'],
  scroll_to_text: ['text'],
  send_keys: ['keys'],
  get_dropdown_options: ['index'],
  select_dropdown_option: ['index', 'text'],
  go_back: [],
  web_search: ['query'],
  wait: ['seconds'],
  extract_content: ['goal'],
  close_tab: [],
  refresh: [],
}

export class BrowserUseTool extends BaseTool {
  name = 'browser_use'
  description = BROWSER_DESCRIPTION
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: Object.values(BrowserAction),
        description: 'The browser action to perform',
      },
      url: {
        type: 'string',
        description: 'URL for \'go_to_url\' or \'open_tab\' actions',
      },
      index: {
        type: 'integer',
        description: 'Element index for \'click_element\', \'input_text\', \'get_dropdown_options\', or \'select_dropdown_option\' actions',
      },
      text: {
        type: 'string',
        description: 'Text for \'input_text\', \'scroll_to_text\', or \'select_dropdown_option\' actions',
      },
      scroll_amount: {
        type: 'integer',
        description: 'Pixels to scroll (positive for down, negative for up) for \'scroll_down\' or \'scroll_up\' actions',
      },
      tab_id: {
        type: 'integer',
        description: 'Tab ID for \'switch_tab\' action',
      },
      query: {
        type: 'string',
        description: 'Search query for \'web_search\' action',
      },
      goal: {
        type: 'string',
        description: 'Extraction goal for \'extract_content\' action',
      },
      keys: {
        type: 'string',
        description: 'Keys to send for \'send_keys\' action',
      },
      seconds: {
        type: 'integer',
        description: 'Seconds to wait for \'wait\' action',
      },
    },
    required: ['action'],
    dependencies: BrowserActionDependencies,
  }

  browser!: BrowserSession
  domService!: DomService
  webSearchTool = new WebSearch()
  llm = new LLM()

  /**
   * Ensure browser and context are initialized.
   */
  async ensureBrowserInitialized() {
    if (!this.browser) {
      const browserProfile = new BrowserProfile({
        headless: false,
        disableSecurity: true,
      })

      if (config.browserConfig?.proxy && config.browserConfig.proxy.server) {
        browserProfile.proxy = {
          server: config.browserConfig.proxy.server,
          username: config.browserConfig.proxy.username,
          password: config.browserConfig.proxy.password,
        }
      }
      const browserAttrs = [
        'headless',
        'disable_security',
        'extra_chromium_args',
        'chrome_instance_path',
        'wss_url',
        'cdp_url',
      ]
      browserAttrs.forEach((attr) => {
        type Key = keyof typeof config.browserConfig
        if (config.browserConfig && config.browserConfig[attr as Key] !== undefined) {
          (browserProfile as any)[attr] = config.browserConfig[attr as Key]
        }
      })

      this.browser = new BrowserSession({
        browserProfile,
      })
      this.domService = new DomService(await this.browser.getCurrentPage())
    }
    return this.browser
  }

  /**
   * Execute a specified browser action.
   * @param params
   */
  async execute(params: BrowserExecuteParams): Promise<ToolResult> {
    try {
      const { action, url, query, index } = params
      const browser = await this.ensureBrowserInitialized()
      const maxContentLength = config.browserConfig?.maxContentLength || 2000
      if (action === BrowserAction.GO_TO_URL) {
        if (!url) {
          return new ToolFailure('URL is required for go_to_url action')
        }
        const page = await browser.getCurrentPage()
        await page.goto(url)
        await page.waitForLoadState()
        return new ToolResult(`Navigated to ${url}`)
      } else if (action === BrowserAction.GO_BACK) {
        await browser.goBack()
        return new ToolResult('Navigated back')
      } else if (action === BrowserAction.REFRESH) {
        await browser.refreshPage()
        return new ToolResult('Refreshed the current page')
      } else if (action === BrowserAction.WEB_SEARCH) {
        if (!query) {
          return new ToolFailure('Query is required for "web_search" action')
        }

        // Execute the web search and return results directly without browser navigation
        const searchResponse = await this.webSearchTool.execute({
          query,
          fetchContent: true,
          numResults: 1,
        })
        const firstSearchResult = searchResponse.results[0]
        const urlToNavigate = firstSearchResult.url
        const page = await browser.getCurrentPage()
        await page.goto(urlToNavigate)
        await page.waitForLoadState()

        return searchResponse
      } else if (action === BrowserAction.CLICK_ELEMENT) {
        if (index === undefined) {
          return new ToolFailure('Index is required for click_element action')
        }
        const element = await this.browser.getDomElementByIndex(index)
        if (!element) {
          return new ToolFailure(`Element with index ${index} not found`)
        }
        let output = `Clicked element with index ${index}`
        const downloadPath = await this.browser.clickElementNode(element)
        if (downloadPath) {
          output += `, downloaded file to ${downloadPath}`
        }

        return new ToolResult(output)
      } else if (action === BrowserAction.INPUT_TEXT) {
        const { text } = params
        if (index === undefined || !text) {
          return new ToolFailure('Index and text are required for input_text action')
        }
        const element = await this.browser.getDomElementByIndex(index)
        if (!element) {
          return new ToolFailure(`Element with index ${index} not found`)
        }

        await this.browser.inputTextElementNode(element, text)
        return new ToolResult(`Input text "${text}" into element with index ${index}`)
      } else if (action === BrowserAction.SCROLL_DOWN || action === BrowserAction.SCROLL_UP) {
        const direction = action === BrowserAction.SCROLL_DOWN ? 1 : -1
        const { scroll_amount = await this.browser.executeJavascript(() => window.innerHeight) } = params
        await this.browser.scrollContainer(direction * scroll_amount)
        return new ToolResult(`Scrolled ${direction > 0 ? 'down' : 'up'} by ${scroll_amount} pixels`)
      } else if (action === BrowserAction.SEND_KEYS) {
        const { keys } = params
        if (!keys) {
          return new ToolFailure('Keys are required for send_keys action')
        }
        const page = await this.browser.getCurrentPage()
        await page.keyboard.press(keys)
        return new ToolResult(`Sent keys: ${keys}`)
      } else if (action === BrowserAction.GET_DROPDOWN_OPTIONS) {
        if (index === undefined) {
          return new ToolFailure('Index is required for get_dropdown_options action')
        }
        const element = await this.browser.getDomElementByIndex(index)
        if (!element) {
          return new ToolFailure(`Element with index ${index} not found`)
        }
        const page = await this.browser.getCurrentPage()
        const options = page.evaluate((xpath) => {
          const select = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as HTMLSelectElement
          if (!select)
            return null
          return Array.from(select.options).map(opt => ({
            text: opt.text,
            value: opt.value,
            index: opt.index,
          }))
        }, element.xpath)

        return new ToolResult(`Dropdown options for element with index ${index}: ${JSON.stringify(options)}`)
      } else if (action === BrowserAction.SELECT_DROPDOWN_OPTION) {
        const { text } = params
        if (index === undefined || !text) {
          return new ToolFailure('Index and text are required for select_dropdown_option action')
        }
        const element = await this.browser.getDomElementByIndex(index)
        if (!element) {
          return new ToolFailure(`Element with index ${index} not found`)
        }
        const page = await this.browser.getCurrentPage()
        const options = await page.selectOption(element.xpath, { label: text })
        return new ToolResult(`Selected option "${text}" in dropdown with index ${index}: ${JSON.stringify(options)}`)
      } else if (action === BrowserAction.EXTRACT_CONTENT) {
        const { goal } = params
        if (!goal) {
          return new ToolFailure('Goal is required for extract_content action')
        }

        const page = await this.browser.getCurrentPage()
        const turndownService = new TurndownService()
        // turndownService.remove(['style', 'script'])
        const content = turndownService.turndown(await page.content())
        const prompt = `
Your task is to extract the content of the page. You will be given a page and a goal, and you should extract all relevant information around this goal from the page. If the goal is vague, summarize the page. Respond in json format.
Extraction goal: {goal}

Page content:
${content.slice(0, maxContentLength)}
`
        const messages: IMessage[] = [{ role: 'system', content: prompt }]

        // Define extraction function schema
        const extractionFunction = {
          type: 'function',
          function: {
            name: 'extract_content',
            description: 'Extract specific information from a webpage based on a goal',
            parameters: {
              type: 'object',
              properties: {
                extracted_content: {
                  type: 'object',
                  description: 'The content extracted from the page according to the goal',
                  properties: {
                    text: {
                      type: 'string',
                      description: 'Text content extracted from the page',
                    },
                    metadata: {
                      type: 'object',
                      description: 'Additional metadata about the extracted content',
                      properties: {
                        source: {
                          type: 'string',
                          description: 'Source of the extracted content',
                        },
                      },
                    },
                  },
                },
              },
              required: ['extracted_content'],
            },
          },
        }

        // Use LLM to extract content with required function calling
        const response = await this.llm.askTool({
          messages,
          tools: [extractionFunction],
          toolChoice: ToolChoice.REQUIRED,
        })

        if (response && response.tool_calls?.length) {
          const args = JSON.parse(response.tool_calls[0].function.arguments)
          const extractedContent = args.extracted_content
          return new ToolResult(`Extracted from page:\n ${JSON.stringify(extractedContent, null, 2)}\n`)
        }
        return new ToolFailure('Failed to extract content from the page')
      } else if (action === BrowserAction.SWITCH_TAB) {
        const { tab_id } = params
        if (tab_id === undefined) {
          return new ToolFailure('Tab ID is required for switch_tab action')
        }
        await this.browser.switchTab(tab_id)
        const page = await this.browser.getCurrentPage()
        await page.waitForLoadState()
        return new ToolResult(`Switched to tab with ID ${tab_id}`)
      } else if (action === BrowserAction.OPEN_TAB) {
        if (!url) {
          return new ToolFailure('URL is required for open_tab action')
        }
        const newTab = await this.browser.createNewTab(url)
        return new ToolResult(`Opened new tab with URL: ${url}`)
      } else if (action === BrowserAction.CLOSE_TAB) {
        await this.browser.closeCurrentTab()
        return new ToolResult('Closed the current tab')
      } else if (action === BrowserAction.WAIT) {
        const { seconds = 3 } = params

        await sleep(seconds * 1000)
        return new ToolResult(`Waited for ${seconds} seconds`)
      }

      return new ToolResult(`Unknown action: ${action}`)
    } catch (error) {
      return new ToolFailure(`Error executing browser action ${params.action}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get the current browser state as a ToolResult.
   * If context is not provided, uses self.context.
   */
  async getCurrentState(browser?: BrowserSession) {
    try {
      browser = browser || this.browser
      if (!browser) {
        return new ToolResult('Browser session is not initialized')
      }
      const state = await browser.getStateSummary(true)

      const page = await this.browser.getCurrentPage()
      await page.bringToFront()
      await page.waitForLoadState()
      const viewportSize = await page.viewportSize()

      const viewportHeight = viewportSize?.height || 0

      const screenshot = (await page.screenshot({
        fullPage: true,
        type: 'jpeg',
        quality: 100,
        animations: 'disabled',
      })).toString('base64')
      const stateInfo = {
        url: state.url,
        title: state.title,
        tabs: [...state.tabs],
        help: '[0], [1], [2], etc., represent clickable indices corresponding to the elements listed. Clicking on these indices will navigate to or interact with the respective content behind them.',
        interactive_elements: state.elementTree.clickableElementsToString(),

        scrollInfo: {
          pixels_above: state.pixelsAbove ?? 0,
          pixels_below: state.pixelsBelow ?? 0,
          total_height: (state.pixelsAbove ?? 0) + (state.pixelsBelow ?? 0)
            + viewportHeight,
        },
        viewportHeight,
      }
      return new ToolResult(JSON.stringify(stateInfo, null, 2), undefined, screenshot)
    } catch (error) {
      return new ToolFailure(`Error getting browser state: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async close() {
    await this.browser?.close()
  }
}

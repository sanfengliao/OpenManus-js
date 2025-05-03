import type { WebSearchEngine } from './search/base'
import axios from 'axios'

import * as cheerio from 'cheerio'
import { retry } from '../decorator/retry'

/**
 * Search the web for information using various search engines
 */

import { logger } from '../logger'
import { BaseTool, ToolResult } from '../tool/base'
import { BaiduSearchEngine } from './search/baidu-search'
import { BingSearchEngine } from './search/bing-search'
import { GoogleSearchEngine } from './search/google-search'

/**
 * Represents a single search result returned by a search engine
 */
export interface SearchResult {
  position: number
  url: string
  title: string
  description: string
  source: string
  rawContent?: string
}

/**
 * Metadata about the search operation
 */
export interface SearchMetadata {
  total_results: number
  language: string
  country: string
}

/**
 * Parameters for search operations
 */
export interface SearchParams {
  query: string
  numResults?: number
  lang?: string
  country?: string
  fetchContent?: boolean
}

/**
 * Configuration options for search operations
 */
export interface SearchConfig {
  retry_delay?: number
  max_retries?: number
  lang?: string
  country?: string
  engine?: string
  fallback_engines?: string[]
}

/**
 * Response structure for search operations
 */
export class SearchResponse extends ToolResult {
  query: string
  results: SearchResult[]
  metadata?: SearchMetadata

  constructor(data: {
    query: string
    results: SearchResult[]
    metadata?: SearchMetadata
    error?: string
  }) {
    super()
    this.query = data.query
    this.results = data.results
    this.metadata = data.metadata
    this.error = data.error
    this.populateOutput()
  }

  private populateOutput(): void {
    if (this.error) {
      return
    }

    const resultText: string[] = [`Search results for '${this.query}':`]

    this.results.forEach((result, i) => {
      const title = result.title.trim() || 'No title'
      resultText.push(`\n${i + 1}. ${title}`)
      resultText.push(`   URL: ${result.url}`)

      if (result.description.trim()) {
        resultText.push(`   Description: ${result.description}`)
      }

      if (result.rawContent) {
        let contentPreview = result.rawContent
          .substring(0, 1000)
          .replace(/\n/g, ' ')
          .trim()
        if (result.rawContent.length > 1000) {
          contentPreview += '...'
        }
        resultText.push(`   Content: ${contentPreview}`)
      }
    })

    if (this.metadata) {
      resultText.push(
        '\nMetadata:',
        `- Total results: ${this.metadata.total_results}`,
        `- Language: ${this.metadata.language}`,
        `- Country: ${this.metadata.country}`,
      )
    }

    this.output = resultText.join('\n')
  }
}

/**
 * Utility class for fetching web content
 */
export class WebContentFetcher {
  /**
   * Fetch and extract the main content from a webpage
   * @param url - The URL to fetch content from
   * @param timeout - Request timeout in seconds
   * @returns Extracted text content or null if fetching fails
   */
  async fetchContent(url: string, timeout: number = 10): Promise<string | null> {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    }

    try {
      const response = await axios.get(url, {
        headers,
        timeout: timeout * 1000,
      })

      if (response.status !== 200) {
        logger.warn(`Failed to fetch content from ${url}: HTTP ${response.status}`)
        return null
      }

      const $ = cheerio.load(response.data)

      // Remove script and style elements
      $('script, style, header, footer, nav').remove()

      // Get text content
      const text = $.text()
        .replace(/\s+/g, ' ')
        .trim()

      // Limit size (10KB max)
      return text ? text.substring(0, 10000) : null
    }
    catch (error) {
      logger.warn(`Error fetching content from ${url}: ${error}`)
      return null
    }
  }
}

export class WebSearch extends BaseTool {
  name = 'web_search'
  description = 'Search the web for real-time information about any topic.'
  parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '(required) The search query to submit to the search engine.',
      },
      numResults: {
        type: 'integer',
        description: '(optional) The number of search results to return. Default is 5.',
        default: 5,
      },
      lang: {
        type: 'string',
        description: '(optional) Language code for search results (default: en).',
        default: 'en',
      },
      country: {
        type: 'string',
        description: '(optional) Country code for search results (default: us).',
        default: 'us',
      },
      fetchContent: {
        type: 'boolean',
        description: '(optional) Whether to fetch full content from result pages. Default is false.',
        default: false,
      },
    },
    required: ['query'],
  }

  private readonly searchEngines: Record<string, WebSearchEngine> = {
    google: new GoogleSearchEngine(),
    baidu: new BaiduSearchEngine(),
    bing: new BingSearchEngine(),
  }

  private readonly contentFetcher = new WebContentFetcher()

  /**
   * Execute a Web search and return detailed search results
   */
  public async execute(params: SearchParams): Promise<ToolResult> {
    const {
      query,
      numResults = 5,
      lang = 'en',
      country = 'us',
      fetchContent = false,
    } = params

    const retryDelay = 60
    const maxRetries = 3

    // Try searching with retries when all engines fail
    for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
      const results = await this.tryAllEngines(query, numResults, { lang, country })

      if (results.length > 0) {
        if (fetchContent) {
          await this.fetchContentForResults(results)
        }

        return new SearchResponse({

          query,
          results,
          metadata: {
            total_results: results.length,
            language: lang,
            country,
          },
        })
      }

      if (retryCount < maxRetries) {
        logger.warn(
          `All search engines failed. Waiting ${retryDelay} seconds before retry ${retryCount + 1}/${maxRetries}...`,
        )
        await new Promise(resolve => setTimeout(resolve, retryDelay * 1000))
      }
    }

    return new SearchResponse({

      query,
      results: [],
      error: 'All search engines failed to return results after multiple retries.',
    })
  }

  /**
   * Try all search engines in the configured order
   */
  private async tryAllEngines(
    query: string,
    numResults: number,
    searchParams: { lang: string, country: string },
  ): Promise<SearchResult[]> {
    const engineOrder = this.getEngineOrder()
    const failedEngines: string[] = []

    for (const engineName of engineOrder) {
      const engine = this.searchEngines[engineName]
      logger.info(`🔎 Attempting search with ${engineName.charAt(0).toUpperCase() + engineName.slice(1)}...`)

      const searchItems = await this.performSearchWithEngine(
        engine,
        query,
        numResults,
        searchParams,
      )

      if (searchItems?.length) {
        if (failedEngines.length) {
          logger.info(
            `Search successful with ${engineName} after trying: ${failedEngines.join(', ')}`,
          )
        }

        return searchItems.map((item, i) => ({
          position: i + 1,
          url: item.url,
          title: item.title || `Result ${i + 1}`,
          description: item.description || '',
          source: engineName,
        }))
      }

      failedEngines.push(engineName)
    }

    if (failedEngines.length) {
      logger.error(`All search engines failed: ${failedEngines.join(', ')}`)
    }
    return []
  }

  /**
   * Determine the order in which to try search engines
   */
  private getEngineOrder(): string[] {
    const preferred = 'google'
    const fallbacks = ['bing', 'baidu']

    const engineOrder = preferred in this.searchEngines ? [preferred] : []

    fallbacks.forEach((fb) => {
      if (fb in this.searchEngines && !engineOrder.includes(fb)) {
        engineOrder.push(fb)
      }
    })

    Object.keys(this.searchEngines).forEach((engine) => {
      if (!engineOrder.includes(engine)) {
        engineOrder.push(engine)
      }
    })

    return engineOrder
  }

  private async performSearchWithEngine(
    engine: WebSearchEngine,
    query: string,
    numResults: number,
    searchParams: { lang: string, country: string },
  ) {
    return engine.performSearch(query, numResults, searchParams)
  }

  private async fetchContentForResults(results: SearchResult[]): Promise<SearchResult[]> {
    if (!results.length) {
      return []
    }

    const tasks = results.map(result => this.fetchSingleResultContent(result))
    return await Promise.all(tasks)
  }

  private async fetchSingleResultContent(result: SearchResult): Promise<SearchResult> {
    if (result.url) {
      const content = await this.contentFetcher.fetchContent(result.url)
      if (content) {
        result.rawContent = content
      }
    }
    return result
  }
}

if (require.main === module) {
  (async () => {
    const webSearch = new WebSearch()

    const result = await webSearch.execute({
      query: 'Python programming',
      fetchContent: true,
      numResults: 1,
    })
    console.log(result.output)
  })()
}

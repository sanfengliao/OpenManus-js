import type { AxiosInstance } from 'axios'

import axios from 'axios'
import * as cheerio from 'cheerio'
import { logger } from '../../logger'
import { SearchItem, WebSearchEngine } from './base'

export interface ParseResult {
  items: SearchItem[]
  nextUrl: string | null
}

const ABSTRACT_MAX_LENGTH = 300

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
]

const HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': USER_AGENTS[0],
  'Referer': 'https://www.bing.com/',
  'Accept-Encoding': 'gzip, deflate',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

const BING_HOST_URL = 'https://www.bing.com'
const BING_SEARCH_URL = 'https://www.bing.com/search?q='

export class BingSearchEngine extends WebSearchEngine {
  private session: AxiosInstance

  constructor() {
    super()
    this.session = axios.create({
      headers: HEADERS,
    })
  }

  private async searchSync(query: string, numResults: number = 10): Promise<SearchItem[]> {
    if (!query) {
      return []
    }

    const listResult: SearchItem[] = []
    let first = 1
    let nextUrl = BING_SEARCH_URL + encodeURIComponent(query)

    while (listResult.length < numResults) {
      const { items, nextUrl: newNextUrl } = await this.parseHtml(nextUrl, listResult.length, first)

      if (items) {
        listResult.push(...items)
      }

      if (!newNextUrl) {
        break
      }

      nextUrl = newNextUrl
      first += 10
    }

    return listResult.slice(0, numResults)
  }

  private async parseHtml(
    url: string,
        rankStart: number = 0,
        first: number = 1,
  ): Promise<ParseResult> {
    try {
      const { data } = await this.session.get(url)
      const $ = cheerio.load(data)

      const listData: SearchItem[] = []
      const olResults = $('#b_results')

      if (!olResults.length) {
        return { items: [], nextUrl: null }
      }

      olResults.find('li.b_algo').each((_, element) => {
        try {
          const $li = $(element)
          const $h2 = $li.find('h2')
          const $p = $li.find('p')

          let title = ''
          let url = ''
          let abstract = ''

          if ($h2.length) {
            title = $h2.text().trim()
            url = $h2.find('a').attr('href')?.trim() || ''
          }

          if ($p.length) {
            abstract = $p.text().trim()
          }

          if (ABSTRACT_MAX_LENGTH && abstract.length > ABSTRACT_MAX_LENGTH) {
            abstract = abstract.substring(0, ABSTRACT_MAX_LENGTH)
          }

          rankStart++

          listData.push(new SearchItem({
            title: title || `Bing Result ${rankStart}`,
            url,
            description: abstract,
          }))
        }
        catch (error) {
          // 继续处理下一个结果
        }
      })

      const nextBtn = $('a[title="Next page"]')
      const nextUrl = nextBtn.length ? BING_HOST_URL + nextBtn.attr('href') : null

      return { items: listData, nextUrl }
    }
    catch (error) {
      logger.warn(`Error parsing HTML: ${error}`)
      return { items: [], nextUrl: null }
    }
  }

  async performSearch(
    query: string,
        numResults: number = 10,
        ...args: any[]
  ): Promise<SearchItem[]> {
    return this.searchSync(query, numResults)
  }
}

if (require.main === module) {
  (async () => {
    const google = new BingSearchEngine()
    const results = await google.performSearch('Python programming', 5)
    console.log(results)
  })()
}

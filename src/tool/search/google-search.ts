import axios from 'axios'
import * as cheerio from 'cheerio'

import { SearchItem, WebSearchEngine } from './base'

/**
 * Generate a random user agent string that mimics various software version formats.
 * 生成一个随机的用户代理字符串，模仿各种软件版本的格式。
 *
 * The user agent string consists of the following parts:
 * 用户代理字符串由以下部分组成：
 * - Lynx version: Lynx/x.y.z, where x is 2-3, y is 8-9, z is 0-2
 * - Lynx版本：Lynx/x.y.z，其中x是2-3，y是8-9，z是0-2
 * - libwww version: libwww-FM/x.y, where x is 2-3, y is 13-15
 * - libwww版本：libwww-FM/x.y，其中x是2-3，y是13-15
 * - SSL-MM version: SSL-MM/x.y, where x is 1-2, y is 3-5
 * - SSL-MM版本：SSL-MM/x.y，其中x是1-2，y是3-5
 * - OpenSSL version: OpenSSL/x.y.z, where x is 1-3, y is 0-4, z is 0-9
 * - OpenSSL版本：OpenSSL/x.y.z，其中x是1-3，y是0-4，z是0-9
 *
 * @returns The randomly generated user agent string
 */
export function getUserAgent(): string {
  const getRandomInt = (min: number, max: number): number =>
    Math.floor(Math.random() * (max - min + 1)) + min

  const lynxVersion = `Lynx/${getRandomInt(2, 3)}.${getRandomInt(8, 9)}.${getRandomInt(0, 2)}`
  const libwwwVersion = `libwww-FM/${getRandomInt(2, 3)}.${getRandomInt(13, 15)}`
  const sslMmVersion = `SSL-MM/${getRandomInt(1, 2)}.${getRandomInt(3, 5)}`
  const opensslVersion = `OpenSSL/${getRandomInt(1, 3)}.${getRandomInt(0, 4)}.${getRandomInt(0, 9)}`

  return `${lynxVersion} ${libwwwVersion} ${sslMmVersion} ${opensslVersion}`
}

export interface SearchOptions {
  numResults?: number
  lang?: string
  advanced?: boolean
  sleepInterval?: number
  timeout?: number
  safe?: string
  sslVerify?: boolean
  region?: string
  startNum?: number
  unique?: boolean
}

export class SearchResult {
  constructor(
    public url: string,
    public title: string,
    public description: string,
  ) {}

  toString(): string {
    return `SearchResult(url=${this.url}, title=${this.title}, description=${this.description})`
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function makeRequest(
  term: string,
  results: number,
  lang: string,
  start: number,
  timeout: number,
  safe: string,
  sslVerify: boolean | null,
  region: string | null,
): Promise<string> {
  const response = await axios.get('https://www.google.com/search', {
    headers: {
      'User-Agent': getUserAgent(),
      'Accept': '*/*',
      'Cookies': 'CONSENT=PENDING+987; SOCS=CAESHAgBEhIaAB',
    },
    params: {
      q: term,
      num: results + 2, // 防止多次请求
      hl: lang,
      start,
      safe,
      gl: region,
    },
    timeout: timeout * 1000,
    validateStatus: status => status === 200,

  })

  return response.data
}

export async function* search(
  term: string,
  options: SearchOptions = {},
): AsyncGenerator<string | SearchResult> {
  const {
    numResults = 10,
    lang = 'en',
    advanced = false,
    sleepInterval = 0,
    timeout = 5,
    safe = 'active',
    sslVerify = null,
    region = null,
    startNum = 0,
    unique = false,
  } = options

  let start = startNum
  let fetchedResults = 0
  const fetchedLinks = new Set<string>()

  while (fetchedResults < numResults) {
    // 发送请求
    const html = await makeRequest(
      term,
      numResults - start,
      lang,
      start,
      timeout,
      safe,
      sslVerify,
      region,
    )

    // 解析
    const $ = cheerio.load(html)
    const resultBlocks = $('div.ezO2md')
    let newResults = 0

    for (const result of resultBlocks.toArray()) {
      const $result = $(result)
      const linkTag = $result.find('a[href]')
      const titleTag = linkTag.find('span.CVA68e')
      const descriptionTag = $result.find('span.FrIlee')

      if (linkTag.length && titleTag.length && descriptionTag.length) {
        const linkHref = linkTag.attr('href') || ''
        const link = decodeURIComponent(
          linkHref.split('&')[0].replace('/url?q=', ''),
        )

        if (fetchedLinks.has(link) && unique) {
          continue
        }

        fetchedLinks.add(link)
        const title = titleTag.text()
        const description = descriptionTag.text()

        fetchedResults++
        newResults++

        if (advanced) {
          yield new SearchResult(link, title, description)
        }
        else {
          yield link
        }

        if (fetchedResults >= numResults) {
          break
        }
      }
    }

    if (newResults === 0) {
      break
    }

    start += 10
    await sleep(sleepInterval * 1000)
  }
}

export class GoogleSearchEngine extends WebSearchEngine {
  /**
   * Perform a Google search and return formatted search results
   * 执行Google搜索并返回格式化的搜索结果
   * @param query Search query | 搜索查询
   * @param numResults Number of results to return | 返回结果数量
   * @returns List of search results | 搜索结果列表
   */
  async performSearch(
    query: string,
        numResults: number = 10,
        ...args: any[]
  ): Promise<SearchItem[]> {
    const rawResults = await search(query, {
      numResults,
      advanced: true,
    })

    const results: SearchItem[] = []
    let index = 0

    for await (const item of rawResults) {
      if (typeof item === 'string') {
        // 如果只是URL
        results.push(new SearchItem({
          title: `Google Result ${index + 1}`,
          url: item,
          description: '',
        }))
      }
      else if (item instanceof SearchResult) {
        results.push(new SearchItem({
          title: item.title,
          url: item.url,
          description: item.description,
        }))
      }
      index++
    }

    return results
  }
}

if (require.main === module) {
  (async () => {
    const google = new GoogleSearchEngine()
    const results = await google.performSearch('Python programming', 5)
    console.log(results)
  })()
}

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as TOML from '@iarna/toml'

export interface LLMSettings {
  model: string
  baseUrl: string
  apiKey: string
  maxTokens: number
  maxInputTokens?: number
  temperature: number
  apiType: string
  apiVersion: string
}

export interface ProxySettings {
  server?: string
  username?: string
  password?: string
}

export interface SearchSettings {
  engine: string
  fallbackEngines: string[]
  retryDelay: number
  maxRetries: number
  lang: string
  country: string
}

export interface BrowserSettings {
  headless: boolean
  disableSecurity: boolean
  extraChromiumArgs: string[]
  chromeInstancePath?: string
  wssUrl?: string
  cdpUrl?: string
  proxy?: ProxySettings
  maxContentLength: number
}

export interface SandboxSettings {
  useSandbox: boolean
  image: string
  workDir: string
  memoryLimit: string
  cpuLimit: number
  timeout: number
  networkEnabled: boolean
}

export interface MCPServerConfig {
  type: string
  url?: string
  command?: string
  args: string[]
}

export interface MCPSettings {
  serverReference: string
  servers: Record<string, MCPServerConfig>
}

export interface AppConfig {
  llm: Record<string, LLMSettings>
  sandbox?: SandboxSettings
  browserConfig?: BrowserSettings
  searchConfig?: SearchSettings
  mcpConfig?: MCPSettings
  logConfig?: {
    writeToFile?: boolean
  }
}

function getProjectRoot() {
  return resolve(__dirname, '..')
}

export const PROJECT_ROOT = getProjectRoot()

export class Config {
  private static instance: Config
  private static initialized: boolean = false
  private config!: AppConfig

  private constructor() {
    if (!Config.initialized) {
      this.loadInitialConfig()
      Config.initialized = true
    }
  }

  public static getInstance(): Config {
    if (!Config.instance) {
      Config.instance = new Config()
    }
    return Config.instance
  }

  private getConfigPath(): string {
    ;
    const configPath = join(PROJECT_ROOT, 'config', 'config.toml')
    const examplePath = join(PROJECT_ROOT, 'config', 'config.example.toml')

    try {
      readFileSync(configPath)
      return configPath
    }
    catch {
      try {
        readFileSync(examplePath)
        return examplePath
      }
      catch {
        throw new Error('No configuration file found in config directory')
      }
    }
  }

  private loadConfig(): any {
    const configPath = this.getConfigPath()
    const configContent = readFileSync(configPath, 'utf-8')
    return TOML.parse(configContent)
  }

  private loadMCPServerConfig(): Record<string, MCPServerConfig> {
    const configPath = join(PROJECT_ROOT, 'config', 'mcp.json')
    try {
      const configContent = readFileSync(configPath, 'utf-8')
      const data = JSON.parse(configContent)
      const servers: Record<string, MCPServerConfig> = {}

      for (const [serverId, serverConfig] of Object.entries(data.mcpServers || {})) {
        const config = serverConfig as any
        servers[serverId] = {
          type: config.type,
          url: config.url,
          command: config.command,
          args: config.args || [],
        }
      }
      return servers
    }
    catch {
      return {}
    }
  }

  private loadInitialConfig(): void {
    const rawConfig = this.loadConfig()
    const baseLlm = rawConfig.llm || {}
    const llmOverrides = Object.entries(baseLlm)
      .filter(([_, v]) => typeof v === 'object')
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {})

    const defaultSettings: LLMSettings = {
      model: baseLlm.model,
      baseUrl: baseLlm.base_url,
      apiKey: baseLlm.api_key,
      maxTokens: baseLlm.max_tokens || 4096,
      maxInputTokens: baseLlm.max_input_tokens,
      temperature: baseLlm.temperature || 1.0,
      apiType: baseLlm.api_type || '',
      apiVersion: baseLlm.api_version || '',
    }

    // 处理浏览器配置
    let browserSettings: BrowserSettings | undefined
    const browserConfig = rawConfig.browser || {}

    if (Object.keys(browserConfig).length > 0) {
      let proxySettings: ProxySettings | undefined
      const proxyConfig = browserConfig.proxy || {}

      if (proxyConfig.server) {
        proxySettings = {
          server: proxyConfig.server,
          username: proxyConfig.username,
          password: proxyConfig.password,
        }
      }

      browserSettings = {
        headless: browserConfig.headless || false,
        disableSecurity: browserConfig.disable_security || true,
        extraChromiumArgs: browserConfig.extra_chromium_args || [],
        chromeInstancePath: browserConfig.chrome_instance_path,
        wssUrl: browserConfig.wss_url,
        cdpUrl: browserConfig.cdp_url,
        proxy: proxySettings,
        maxContentLength: browserConfig.max_content_length || 2000,
      }
    }

    // 处理搜索配置
    let searchSettings: SearchSettings | undefined
    const searchConfig = rawConfig.search || {}

    if (Object.keys(searchConfig).length > 0) {
      searchSettings = {
        engine: searchConfig.engine || 'Google',
        fallbackEngines: searchConfig.fallback_engines || ['DuckDuckGo', 'Baidu', 'Bing'],
        retryDelay: searchConfig.retry_delay || 60,
        maxRetries: searchConfig.max_retries || 3,
        lang: searchConfig.lang || 'en',
        country: searchConfig.country || 'us',
      }
    }

    // 处理沙箱配置
    const sandboxConfig = rawConfig.sandbox || {}
    const sandboxSettings: SandboxSettings = {
      useSandbox: sandboxConfig.use_sandbox || false,
      image: sandboxConfig.image || 'python:3.12-slim',
      workDir: sandboxConfig.work_dir || '/workspace',
      memoryLimit: sandboxConfig.memory_limit || '512m',
      cpuLimit: sandboxConfig.cpu_limit || 1.0,
      timeout: sandboxConfig.timeout || 300,
      networkEnabled: sandboxConfig.network_enabled || false,
    }

    // 处理 MCP 配置
    const mcpConfig = rawConfig.mcp || {}
    const mcpSettings: MCPSettings = {
      serverReference: mcpConfig.server_reference || 'app.mcp.server',
      servers: this.loadMCPServerConfig(),
    }

    const logConfig = rawConfig.log || {}

    this.config = {
      llm: {
        default: defaultSettings,
        ...Object.entries(llmOverrides).reduce((acc, [name, config]) => ({
          ...acc,
          // @ts-expect-error
          [name]: { ...defaultSettings, ...config },
        }), {}),
      },
      sandbox: sandboxSettings,
      browserConfig: browserSettings,
      searchConfig: searchSettings,
      mcpConfig: mcpSettings,
      logConfig,
    }
  }

  public get llm(): Record<string, LLMSettings> {
    return this.config.llm
  }

  public get sandbox(): SandboxSettings {
    return this.config.sandbox!
  }

  public get browserConfig(): BrowserSettings | undefined {
    return this.config.browserConfig
  }

  public get searchConfig(): SearchSettings | undefined {
    return this.config.searchConfig
  }

  public get mcpConfig(): MCPSettings {
    return this.config.mcpConfig!
  }

  public get logConfig() {
    return this.config.logConfig || {}
  }

  public get workspaceRoot(): string {
    return PROJECT_ROOT
  }

  public get rootPath(): string {
    return PROJECT_ROOT
  }
}

export const config = Config.getInstance()

console.log('🚀 Config loaded:', config.llm)

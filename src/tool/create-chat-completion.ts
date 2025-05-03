import { BaseTool } from './base'

export interface TypeMapping {
  [key: string]: string
}

export interface SchemaType {
  type: string
  properties?: Record<string, any>
  required?: string[]
  items?: Record<string, any>
  additionalProperties?: Record<string, any>
  anyOf?: Record<string, any>[]
  description?: string
}

export class CreateChatCompletion extends BaseTool {
  public readonly name = 'create_chat_completion'
  public readonly description = 'Creates a structured completion with specified output formatting.'

  private readonly typeMapping: TypeMapping = {
    String: 'string',
    Number: 'number',
    Boolean: 'boolean',
    Object: 'object',
    Array: 'array',
  }

  private ResponseType: any
  private required: string[]

  constructor(responseType: any = String) {
    super()
    this.ResponseType = responseType
    this.required = ['response']
    this.parameters = this.buildParameters()
  }

  private buildParameters(): SchemaType {
    if (this.ResponseType === String) {
      return {
        type: 'object',
        properties: {
          response: {
            type: 'string',
            description: 'The response text that should be delivered to the user.',
          },
        },
        required: this.required,
      }
    }

    if (this.isBaseModel(this.ResponseType)) {
      const schema = this.ResponseType.prototype.toJSON()
      return {
        type: 'object',
        properties: schema.properties,
        required: schema.required || this.required,
      }
    }

    return this.createTypeSchema(this.ResponseType)
  }

  private createTypeSchema(typeHint: any): SchemaType {
    const origin = this.getOrigin(typeHint)
    const args = this.getTypeArguments(typeHint)

    // Handle primitive types
    if (!origin) {
      return {
        type: 'object',
        properties: {
          response: {
            type: this.typeMapping[typeHint.name] || 'string',
            description: `Response of type ${typeHint.name}`,
          },
        },
        required: this.required,
      }
    }

    // Handle Array type
    if (origin === Array) {
      const itemType = args?.[0] || Object
      return {
        type: 'object',
        properties: {
          response: {
            type: 'array',
            items: this.getTypeInfo(itemType),
          },
        },
        required: this.required,
      }
    }

    // Handle Object type
    if (origin === Object) {
      const valueType = args?.[1] || Object
      return {
        type: 'object',
        properties: {
          response: {
            type: 'object',
            additionalProperties: this.getTypeInfo(valueType),
          },
        },
        required: this.required,
      }
    }

    // Handle Union type
    if (this.isUnionType(typeHint)) {
      return this.createUnionSchema(args)
    }

    return this.buildParameters()
  }

  private getTypeInfo(typeHint: any): SchemaType {
    if (this.isBaseModel(typeHint)) {
      return typeHint.prototype.toJSON()
    }

    return {
      type: this.typeMapping[typeHint.name] || 'string',
      description: `Value of type ${typeHint.name || 'any'}`,
    }
  }

  private createUnionSchema(types: any[]): SchemaType {
    return {
      type: 'object',
      properties: {
        response: {
          anyOf: types.map(t => this.getTypeInfo(t)),
        },
      },
      required: this.required,
    }
  }

  private isBaseModel(type: any): boolean {
    return type?.prototype
  }

  private isUnionType(type: any): boolean {
    return type?.toString().startsWith('Union')
  }

  private getOrigin(type: any): any {
    if (Array.isArray(type?.prototype))
      return Array
    if (type?.prototype instanceof Object)
      return Object
    return null
  }

  private getTypeArguments(type: any): any[] {
    return type?.arguments || []
  }

  async execute(params: {
    required?: string[]
    [key: string]: any
  }): Promise<any> {
    const { required = this.required, ...kwargs } = params

    // Handle case when required is a list
    if (Array.isArray(required) && required.length > 0) {
      if (required.length === 1) {
        const requiredField = required[0]
        const result = kwargs[requiredField] || ''
        return this.convertResult(result)
      }
      else {
        // Return multiple fields as a dictionary
        return required.reduce((acc, field) => {
          acc[field] = kwargs[field] || ''
          return acc
        }, {} as Record<string, any>)
      }
    }

    const result = kwargs.response || ''
    return this.convertResult(result)
  }

  private convertResult(result: any): any {
    if (this.ResponseType === String) {
      return String(result)
    }

    if (this.isBaseModel(this.ResponseType)) {
      return new this.ResponseType(result)
    }

    if (this.getOrigin(this.ResponseType) === Array
      || this.getOrigin(this.ResponseType) === Object) {
      return result
    }

    try {
      return this.ResponseType(result)
    }
    catch {
      return result
    }
  }
}
